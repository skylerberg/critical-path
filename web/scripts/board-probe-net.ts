// Dev-only, imported first by board-probe.ts (NOT shipped).
//
// The probe seeds the board's state directly and mounts the real component on
// top of it, so there is no server behind it and it needs none. Left to reach
// the network, a mutation the check drives has two ways to spoil the
// measurement, and which one it picks depends on whose machine it runs on:
// with nothing on the API port the request never gets an answer, so the outbox
// treats it as offline and queues it in IndexedDB, where it outlives the page
// and drains into the next case; with the API running — which is what
// CLAUDE.md tells everyone to do — it succeeds against a real database and the
// board resyncs to whatever that holds. Both stop measuring the board the probe
// set up, and the second one only ever happens locally, so CI cannot catch it.
//
// Answering /api here closes both. The recording is the other half: it makes
// "the board mounted without talking to a server" something the check asserts
// rather than a silence it has to trust, and it lets a drop's destination be
// read from the request the board really sent instead of from a stub standing
// in for the code that sends it.
export interface ProbeRequest {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

const requests: ProbeRequest[] = [];
(window as unknown as { __requests: ProbeRequest[] }).__requests = requests;

const realFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url, location.origin);
  // Vite's own traffic — module graph, source maps — is not the probe's business.
  if (url.origin !== location.origin || !url.pathname.startsWith('/api')) {
    return realFetch(input as RequestInfo, init);
  }

  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await request.clone().json();
    if (typeof parsed === 'object' && parsed !== null) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // A GET carries no body; that is not a problem worth reporting.
  }
  requests.push({ method: request.method, path: url.pathname, body });

  // Everything is answered, including requests no case expects, because a
  // refusal is not inert: the board reports it, resyncs, and asks again, so one
  // unexpected call becomes a cascade that buries the assertion meant to catch
  // it. The check reads the recording and fails on the request itself instead.
  return new Response(JSON.stringify(body ?? {}), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
