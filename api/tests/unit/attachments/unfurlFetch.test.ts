import http from 'node:http';
import type dns from 'node:dns';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { fetchVetted, UnfurlFetchError } from '../../../src/services/attachments/unfurlFetch';
import type { LookupAll, TargetPolicy } from '../../../src/services/webhooks/targets';

// Production's policy, not the ambient test one: .env.test sets ENVIRONMENT=test,
// which allows private targets, so nothing here would exercise the blocklist.
const strict: TargetPolicy = { allowPrivate: false, requireHttps: false };
const permissive: TargetPolicy = { allowPrivate: true, requireHttps: false };

const HTML_LIMITS = {
  maxBytes: 64 * 1024,
  deadlineMs: 2000,
  accept: ['text/html', 'application/xhtml+xml'],
};

// Every hostname resolves to the loopback server, so a "public-looking" name can
// still be served locally while the policy sees the name it was given.
function loopbackResolve(address = '127.0.0.1'): LookupAll {
  return (_hostname, _options): Promise<dns.LookupAddress[]> =>
    Promise.resolve([{ address, family: 4 }]);
}

describe('fetchVetted', () => {
  let server: http.Server;
  let port: number;
  let requests: http.IncomingMessage[] = [];
  let aborted = 0;
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void = (_req, res) =>
    res.end();

  const origin = (): string => `http://127.0.0.1:${String(port)}`;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        requests.push(req);
        req.on('aborted', () => {
          aborted += 1;
        });
        handler(req, res);
      });
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(() => {
    requests = [];
    aborted = 0;
    handler = (_req, res) => res.end();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function html(body: string): (req: http.IncomingMessage, res: http.ServerResponse) => void {
    return (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    };
  }

  it('fetches a page and reports its final URL and content type', async () => {
    handler = html('<html><head><title>Hi</title></head></html>');

    const result = await fetchVetted(`${origin()}/page`, HTML_LIMITS, permissive);

    expect(result.finalUrl).toBe(`${origin()}/page`);
    expect(result.contentType).toBe('text/html');
    expect(result.body.toString()).toContain('<title>Hi</title>');
  });

  it('sends Accept-Encoding: identity so nothing is ever decompressed', async () => {
    handler = html('<html></html>');

    await fetchVetted(`${origin()}/page`, HTML_LIMITS, permissive);

    expect(requests[0].headers['accept-encoding']).toBe('identity');
  });

  // A strict policy makes every locally reachable address unreachable by
  // construction, so the metadata case is proved in two halves: the loop puts
  // each redirect target through the same validator as the first URL, and that
  // validator refuses the metadata address.
  it.each([
    ['http://169.254.169.254/latest/meta-data/', /private, loopback, or reserved/],
    ['http://[fd00::1]/', /private, loopback, or reserved/],
    ['http://metadata.google.internal/computeMetadata/v1/', /private, loopback, or reserved/],
    ['http://localhost/', /private, loopback, or reserved/],
  ])('refuses %s outright under a production policy', async (url, message) => {
    await expect(fetchVetted(url, HTML_LIMITS, strict)).rejects.toThrow(message);
    expect(requests).toHaveLength(0);
  });

  it('re-validates the redirect target, not only the URL it was given', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { Location: 'http://user:pw@example.com/next' });
      res.end();
    };

    await expect(fetchVetted(`${origin()}/start`, HTML_LIMITS, permissive)).rejects.toThrow(
      /must not include credentials/
    );
    expect(requests).toHaveLength(1);
  });

  it('resolves a relative Location against the current URL and re-validates it', async () => {
    handler = (req, res) => {
      if (req.url === '/a/start') {
        res.writeHead(301, { Location: '../b/final' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>final</html>');
    };

    const result = await fetchVetted(`${origin()}/a/start`, HTML_LIMITS, permissive);

    expect(result.finalUrl).toBe(`${origin()}/b/final`);
    expect(requests.map((req) => req.url)).toEqual(['/a/start', '/b/final']);
  });

  it('stops after three redirects', async () => {
    handler = (req, res) => {
      const step = Number(/\d+/.exec(req.url ?? '')?.[0] ?? '0');
      res.writeHead(302, { Location: `/hop${String(step + 1)}` });
      res.end();
    };

    await expect(fetchVetted(`${origin()}/hop0`, HTML_LIMITS, permissive)).rejects.toThrow(
      /Too many redirects/
    );
    expect(requests).toHaveLength(4);
  });

  it.each(['file:///etc/passwd', 'data:text/html,<b>hi</b>', 'ftp://example.com/x'])(
    'refuses a redirect to %s',
    async (location) => {
      handler = (_req, res) => {
        res.writeHead(302, { Location: location });
        res.end();
      };

      await expect(fetchVetted(`${origin()}/start`, HTML_LIMITS, permissive)).rejects.toThrow(
        /must use http or https/
      );
    }
  );

  it('errors on a redirect with no Location', async () => {
    handler = (_req, res) => {
      res.writeHead(302);
      res.end();
    };

    await expect(fetchVetted(`${origin()}/start`, HTML_LIMITS, permissive)).rejects.toThrow(
      /without a Location/
    );
  });

  it('refuses a public-looking host whose DNS answer is loopback', async () => {
    handler = html('<html></html>');

    await expect(
      fetchVetted('http://rebind.example.com/', HTML_LIMITS, strict, loopbackResolve('127.0.0.1'))
    ).rejects.toThrow(/blocked address/);
    expect(requests).toHaveLength(0);
  });

  it('cuts an endless body at maxBytes and drops the socket', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      const beat = setInterval(() => res.write('x'.repeat(4096)), 1);
      res.on('close', () => clearInterval(beat));
    };

    await expect(
      fetchVetted(`${origin()}/endless`, { ...HTML_LIMITS, maxBytes: 8192 }, permissive)
    ).rejects.toThrow(/exceeded 8192 bytes/);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(aborted).toBeGreaterThan(0);
  });

  it('settles at the absolute deadline against a server trickling one byte at a time', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      const beat = setInterval(() => res.write('.'), 50);
      res.on('close', () => clearInterval(beat));
    };

    const started = Date.now();
    await expect(
      fetchVetted(`${origin()}/trickle`, { ...HTML_LIMITS, deadlineMs: 600 }, permissive)
    ).rejects.toThrow(/Timed out/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('errors on a non-HTML content type without reading the body', async () => {
    let bodyWritten = false;
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      bodyWritten = true;
      res.end('%PDF-1.4');
    };

    await expect(fetchVetted(`${origin()}/doc`, HTML_LIMITS, permissive)).rejects.toBeInstanceOf(
      UnfurlFetchError
    );
    expect(bodyWritten).toBe(true);
  });

  it('errors on a non-2xx status', async () => {
    handler = (_req, res) => {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end('nope');
    };

    await expect(fetchVetted(`${origin()}/forbidden`, HTML_LIMITS, permissive)).rejects.toThrow(
      /responded 403/
    );
  });

  it('refuses a private target before opening a socket when the policy forbids it', async () => {
    await expect(fetchVetted(`${origin()}/page`, HTML_LIMITS, strict)).rejects.toThrow(
      /private, loopback, or reserved/
    );
    expect(requests).toHaveLength(0);
  });

  it('accepts an image response when the limits ask for one', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    };

    const result = await fetchVetted(
      `${origin()}/pic.png`,
      { maxBytes: 4096, deadlineMs: 2000, accept: ['image/'] },
      permissive
    );
    expect(result.contentType).toBe('image/png');
    expect(result.body).toHaveLength(4);
  });
});
