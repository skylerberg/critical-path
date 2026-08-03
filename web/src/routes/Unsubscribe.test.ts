import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Unsubscribe from './Unsubscribe.svelte';

beforeEach(() => {
  fetchMock.mockReset();
  window.history.replaceState(null, '', '/unsubscribe');
});

async function confirm(): Promise<void> {
  await fireEvent.click(await screen.findByRole('button', { name: 'Unsubscribe' }));
}

describe('Unsubscribe', () => {
  it('writes nothing until the visitor presses the button', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { kind: 'task_assigned' }));
    render(Unsubscribe, { token: 'tok-123' });

    expect(
      await screen.findByText('Stop sending you these notification emails?')
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled();
    });

    await confirm();

    expect(
      await screen.findByText(
        'This address will no longer get email when someone assigns you a task.'
      )
    ).toBeInTheDocument();
    const request = requestAt(0);
    expect(new URL(request.url).pathname).toBe('/api/auth/unsubscribe');
    expect(await request.clone().json()).toEqual({ token: 'tok-123' });
  });

  it('names the digest kind when that is what the link switched off', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { kind: 'bulk_task_assigned' }));
    render(Unsubscribe, { token: 'tok-123' });
    await confirm();

    expect(
      await screen.findByText(
        'This address will no longer get email when someone assigns you several cards at once.'
      )
    ).toBeInTheDocument();
  });

  // A 204 here is also the answer for a link whose address has moved on, which
  // matches no row, so the promise has to be one that holds in that case too.
  it('offers a second step, and promises it of the address rather than of a write', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { kind: 'added_to_project' }));
    render(Unsubscribe, { token: 'tok-123' });
    await confirm();

    const button = await screen.findByRole('button', { name: 'Turn off all email notifications' });
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await fireEvent.click(button);

    expect(
      await screen.findByText('This address will no longer get any notification email from us.')
    ).toBeInTheDocument();
    expect(new URL(requestAt(1).url).pathname).toBe('/api/auth/unsubscribe/all');
  });

  it('reports a rejected token without offering anything else', async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, { error: 'This unsubscribe link is not valid' }));
    render(Unsubscribe, { token: 'stale' });
    await confirm();

    expect(await screen.findByText("This unsubscribe link isn't valid.")).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Turn off all email notifications' })
    ).not.toBeInTheDocument();
  });

  it('lets the visitor retry when the server fails rather than blaming the link', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));
    render(Unsubscribe, { token: 'tok-123' });
    await confirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.'
    );
    expect(screen.queryByText("This unsubscribe link isn't valid.")).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { kind: 'task_assigned' }));
    await confirm();

    expect(
      await screen.findByText(
        'This address will no longer get email when someone assigns you a task.'
      )
    ).toBeInTheDocument();
  });

  it('keeps the committed single unsubscribe when turning off all fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { kind: 'added_to_project' }));
    render(Unsubscribe, { token: 'tok-123' });
    await confirm();

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Turn off all email notifications' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.'
    );
    expect(screen.queryByText("This unsubscribe link isn't valid.")).not.toBeInTheDocument();
    expect(
      screen.getByText('This address will no longer get email when someone adds you to a board.')
    ).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await fireEvent.click(screen.getByRole('button', { name: 'Turn off all email notifications' }));

    expect(
      await screen.findByText('This address will no longer get any notification email from us.')
    ).toBeInTheDocument();
  });

  it('never calls the API without a token', async () => {
    render(Unsubscribe, { token: undefined });

    expect(await screen.findByText("This unsubscribe link isn't valid.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unsubscribe' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('says nothing about the account behind the link, at either step', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { kind: 'task_assigned' }));
    const { container } = render(Unsubscribe, { token: 'tok-123' });
    await confirm();

    await screen.findByText(
      'This address will no longer get email when someone assigns you a task.'
    );
    expect(container.textContent).not.toContain('@');
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await fireEvent.click(screen.getByRole('button', { name: 'Turn off all email notifications' }));

    await screen.findByText('This address will no longer get any notification email from us.');
    expect(container.textContent).not.toContain('@');
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
  });
});
