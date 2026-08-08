import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { matchRoute } from '../lib/router.svelte';
import { session } from '../lib/session.svelte';
import VerifyEmail from './VerifyEmail.svelte';

// A link the API actually minted, kept whole: the token's dot and base64url
// padding are the parts a query parser is most likely to mangle.
const EMAILED_LINK =
  'https://criticalpath.skylerberg.com/verify-email?token=' +
  'eyJ0IjoidmVyaWZ5IiwidWlkIjoiYTNiYjE4OWUtOGJmOS0zODg4LTk5MTItYWNlNGU2NTQzMDAyIiwi' +
  'ZWgiOiJ0ZnlGNVZkVi1lRFFNS0VLdEVLYmF3IiwiZXhwIjoxNzg1NzU2NjgxOTM5fQ' +
  '.xqAYaRgbdi-F9z94fuUaeYnove-7CH9RLlFiW7I7g70';

const EXPIRED = { error: 'Verification link has expired' };
const INVALID = { error: 'Invalid verification link' };

const VERIFIED = 'That email address is verified.';

const ME = {
  id: 'u-me',
  email: 'me@example.com',
  name: 'Me',
  avatar_url: null,
  email_verified: false,
};

beforeEach(() => {
  fetchMock.mockReset();
  session.forget();
  window.history.replaceState(null, '', '/verify-email');
});

describe('VerifyEmail', () => {
  it('carries a signed-out click on the emailed link through to a redeemed token', async () => {
    const link = new URL(EMAILED_LINK);
    const route = matchRoute(link.pathname, link.search);
    if (route.name !== 'verify-email') {
      throw new Error(`the emailed link routed to ${route.name}`);
    }
    expect(session.status).toBe('anon');
    expect(session.guardRoute(route, link.pathname + link.search)).toBeUndefined();

    fetchMock.mockResolvedValue(jsonResponse(204));
    render(VerifyEmail, { token: route.params.token });

    expect(await screen.findByText(VERIFIED)).toBeInTheDocument();
    expect(await requestAt(0).clone().json()).toEqual({ token: link.searchParams.get('token') });
  });

  // The 204 for a replayed link is the same 204 as the first redemption, so
  // success has to carry no failure affordance for the second click to be quiet.
  it('redeems the token on load and reports success with nothing left to fix', async () => {
    fetchMock.mockResolvedValue(jsonResponse(204));
    render(VerifyEmail, { token: 'tok-live' });

    expect(await screen.findByText(VERIFIED)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    const request = requestAt(0);
    expect(new URL(request.url).pathname).toBe('/api/auth/verify-email');
    expect(request.method).toBe('POST');
    expect(await request.clone().json()).toEqual({ token: 'tok-live' });
  });

  // The endpoint is unauthenticated and answers nothing about the account, so a
  // visitor signed in as one person clicking another's link must not be told
  // anything about their own mailbox.
  it('claims nothing about whose address was verified', async () => {
    session.status = 'authed';
    fetchMock.mockResolvedValue(jsonResponse(204));
    render(VerifyEmail, { token: 'tok-someone-else' });

    await screen.findByText(VERIFIED);
    expect(screen.queryByText(/your email address/i)).toBeNull();
  });

  // Nothing else tells this tab the address is confirmed, so the rest of the
  // session would go on treating a verified account as unverified.
  it('catches a signed-in visitor’s own verification flag up', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'tok', user: ME }));
    await session.login(ME.email, 'password123');
    fetchMock.mockReset();

    fetchMock
      .mockResolvedValueOnce(jsonResponse(204))
      .mockResolvedValueOnce(jsonResponse(200, { ...ME, email_verified: true }));
    render(VerifyEmail, { token: 'tok-live' });

    await screen.findByText(VERIFIED);
    await waitFor(() => expect(session.user?.email_verified).toBe(true));
    expect(new URL(requestAt(1).url).pathname).toBe('/api/auth/me');
  });

  it('sends a signed-out visitor to log in, and a signed-in one back into the app', async () => {
    fetchMock.mockResolvedValue(jsonResponse(204));
    render(VerifyEmail, { token: 'tok-live' });
    expect(await screen.findByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');

    cleanup();
    session.status = 'authed';
    render(VerifyEmail, { token: 'tok-live' });
    expect(await screen.findByRole('link', { name: 'Continue to Critical Path' })).toHaveAttribute(
      'href',
      '/'
    );
  });

  it('reports an expired link as expired', async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, EXPIRED));
    render(VerifyEmail, { token: 'tok-stale' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link has expired.');
  });

  // A tampered token, an unknown account and an address the account has left all
  // come back as this one message so the endpoint cannot be used to tell them
  // apart. Rendering it verbatim is what keeps the page from re-splitting them.
  it('shows the rejection verbatim, adding no guess about the cause', async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, INVALID));
    render(VerifyEmail, { token: 'tok-tampered' });

    expect((await screen.findByRole('alert')).textContent).toBe('Invalid verification link.');
  });

  it('does not double the punctuation of a message that already ends in a stop', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, { details: [{ path: 'token', message: 'must be a string...' }] })
    );
    render(VerifyEmail, { token: 'tok-bad' });

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Validation failed: token: must be a string...'
    );
  });

  it('rejects a link with no token without calling the API', async () => {
    render(VerifyEmail, { token: undefined });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This link is missing its verification code.'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The same component instance is reused when a second emailed link is opened,
  // so a stale outcome would sit over a token that was never redeemed.
  it('re-redeems when the token prop changes under the same instance', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(422, EXPIRED));
    const { rerender } = render(VerifyEmail, { token: 'tok-stale' });
    await screen.findByRole('alert');

    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await rerender({ token: 'tok-fresh' });

    expect(await screen.findByText(VERIFIED)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await requestAt(1).clone().json()).toEqual({ token: 'tok-fresh' });
  });

  // The overlap, not the sequence: the second link is opened before the first
  // redemption has answered, so the slower earlier one settles last.
  it('keeps the newest token’s success when an older rejection settles late', async () => {
    let releaseStale!: (value: Response) => void;
    const stale = new Promise<Response>((resolve) => {
      releaseStale = resolve;
    });
    fetchMock
      .mockImplementationOnce(() => stale)
      .mockImplementationOnce(async () => jsonResponse(204));

    const { rerender } = render(VerifyEmail, { token: 'tok-stale' });
    await rerender({ token: 'tok-fresh' });
    expect(await screen.findByText(VERIFIED)).toBeInTheDocument();

    releaseStale(jsonResponse(422, EXPIRED));
    await stale;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(VERIFIED)).toBeInTheDocument();
  });

  // The same overlap the other way round, which is the only ordering that can
  // report an address as verified off a token nothing ever redeemed.
  it('keeps the newest token’s rejection when an older success settles late', async () => {
    let releaseOlder!: (value: Response) => void;
    const older = new Promise<Response>((resolve) => {
      releaseOlder = resolve;
    });
    fetchMock
      .mockImplementationOnce(() => older)
      .mockImplementationOnce(async () => jsonResponse(422, EXPIRED));

    const { rerender } = render(VerifyEmail, { token: 'tok-slow-valid' });
    await rerender({ token: 'tok-fresh-rejected' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link has expired.');

    releaseOlder(jsonResponse(204));
    await older;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByText(VERIFIED)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Verification link has expired.');
  });

  it('offers a signed-in visitor a fresh link when the token is rejected', async () => {
    session.status = 'authed';
    fetchMock.mockResolvedValueOnce(jsonResponse(422, EXPIRED));
    render(VerifyEmail, { token: 'tok-stale' });
    await screen.findByRole('alert');

    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));

    // Definite now: the button is offered only while this tab believes its own
    // address unverified, which account_updated keeps current.
    const sent = await screen.findByText('A new link is on its way.');
    expect(sent).toHaveAttribute('role', 'status');
    expect(sent.className).not.toContain('text-danger');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/auth/verify-email/resend');
  });

  // The resend mails the caller's own address, never the one the link was for,
  // so a caller already verified would get the same 204 having sent nothing.
  // Landing here after verifying with a newer link is the common way to do it.
  it('offers no new link to a visitor whose own address is already verified', async () => {
    session.status = 'authed';
    session.user = { ...ME, email_verified: true };
    fetchMock.mockResolvedValueOnce(jsonResponse(422, EXPIRED));
    render(VerifyEmail, { token: 'tok-stale' });
    await screen.findByRole('alert');

    expect(screen.queryByRole('button', { name: 'Send a new link' })).toBeNull();
    expect(
      screen.getByText('Your address is already verified, so there is no new link to send.')
    ).toBeInTheDocument();
  });

  // Opening a second link must neither leave its resend button dead nor let the
  // first link's answer speak for it.
  it('lets go of a resend asked for under the previous token', async () => {
    session.status = 'authed';
    fetchMock.mockResolvedValueOnce(jsonResponse(422, EXPIRED));
    const { rerender } = render(VerifyEmail, { token: 'tok-stale' });
    await screen.findByRole('alert');

    let releaseResend!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      releaseResend = resolve;
    });
    fetchMock.mockImplementationOnce(() => pending);
    await fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));
    expect(screen.getByRole('button', { name: 'Send a new link' })).toBeDisabled();

    fetchMock.mockResolvedValueOnce(jsonResponse(422, EXPIRED));
    await rerender({ token: 'tok-stale-too' });
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Send a new link' })).toBeEnabled();

    releaseResend(jsonResponse(429, { error: 'Too many verification emails' }));
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByText(/Too many verification emails/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Send a new link' })).toBeEnabled();
  });

  it('renders a throttled resend as an error, not in the success slot', async () => {
    session.status = 'authed';
    fetchMock.mockResolvedValueOnce(jsonResponse(422, EXPIRED));
    render(VerifyEmail, { token: 'tok-stale' });
    await screen.findByRole('alert');

    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { error: 'Too many verification emails, please try again later' })
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));

    const throttled = await screen.findByText(
      'Too many verification emails, please try again later.'
    );
    expect(throttled).toHaveAttribute('role', 'alert');
    expect(throttled.className).toContain('text-danger');
  });

  it('offers a signed-out visitor no resend button, only a way to log in', async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, EXPIRED));
    render(VerifyEmail, { token: 'tok-stale' });
    await screen.findByRole('alert');

    expect(screen.queryByRole('button', { name: 'Send a new link' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });

  it('keeps an unreachable server distinct from a bad link, and retries', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    render(VerifyEmail, { token: 'tok-live' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the server. Your link is still good — try again.'
    );

    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(VERIFIED)).toBeInTheDocument();
    expect(await requestAt(1).clone().json()).toEqual({ token: 'tok-live' });
  });

  // A 500, an ingress 502 and a WAF 429 all reached the server; telling the
  // visitor it was unreachable sends them to check their own connection.
  it('does not call a server that answered unreachable', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { error: 'Service Unavailable' }));
    render(VerifyEmail, { token: 'tok-live' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Your link is still good — try again.'
    );
  });

  // Every terminal state is a dead end otherwise: auth-optional routes render
  // without the app's navigation.
  it('leaves a way back into the app from every failure', async () => {
    session.status = 'authed';
    fetchMock.mockResolvedValueOnce(jsonResponse(422, EXPIRED));
    render(VerifyEmail, { token: 'tok-stale' });
    await screen.findByRole('alert');
    expect(screen.getByRole('link', { name: 'Continue to Critical Path' })).toHaveAttribute(
      'href',
      '/'
    );

    cleanup();
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    render(VerifyEmail, { token: 'tok-live' });
    await screen.findByRole('alert');
    expect(screen.getByRole('link', { name: 'Continue to Critical Path' })).toHaveAttribute(
      'href',
      '/'
    );
  });
});
