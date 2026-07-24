import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import FeedbackDialog from './FeedbackDialog.svelte';
import { router } from '../lib/router.svelte';
import { toasts } from '../lib/toasts.svelte';

beforeEach(() => {
  fetchMock.mockReset();
  for (const toast of [...toasts.toasts]) {
    toasts.dismiss(toast.id);
  }
  router.beforeNavigate = undefined;
  router.navigate('/projects/p-42', { replace: true });
});

describe('FeedbackDialog', () => {
  it('disables Send while the message is empty or whitespace', async () => {
    render(FeedbackDialog, { open: true, onclose: vi.fn() });

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();

    await fireEvent.input(screen.getByLabelText('Feedback message'), { target: { value: '   ' } });
    expect(send).toBeDisabled();

    await fireEvent.click(send);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the message with the current page path, toasts success, and closes', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { id: 'f-1', created_at: '2026-07-23T00:00:00.000Z' })
    );
    const onclose = vi.fn();
    render(FeedbackDialog, { open: true, onclose });

    await fireEvent.input(screen.getByLabelText('Feedback message'), {
      target: { value: '  The graph view is great  ' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(onclose).toHaveBeenCalledOnce();
    });
    const request = requestAt(0);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/feedback');
    const body = (await request.clone().json()) as Record<string, unknown>;
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(body.message).toBe('The graph view is great');
    expect(body.page_path).toBe('/projects/p-42');
    expect(toasts.toasts).toEqual([
      expect.objectContaining({ variant: 'success', message: 'Feedback sent — thank you!' }),
    ]);
    expect(screen.getByLabelText<HTMLTextAreaElement>('Feedback message').value).toBe('');
  });

  it('keeps the text and shows an error toast when the request fails', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: 'Too many requests' }));
    const onclose = vi.fn();
    render(FeedbackDialog, { open: true, onclose });

    await fireEvent.input(screen.getByLabelText('Feedback message'), {
      target: { value: 'Something broke' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(toasts.toasts).toEqual([
        expect.objectContaining({ variant: 'error', message: 'Too many requests' }),
      ]);
    });
    expect(onclose).not.toHaveBeenCalled();
    expect(screen.getByLabelText<HTMLTextAreaElement>('Feedback message').value).toBe(
      'Something broke'
    );
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('sends only one request while a submit is in flight', async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      })
    );
    render(FeedbackDialog, { open: true, onclose: vi.fn() });

    await fireEvent.input(screen.getByLabelText('Feedback message'), {
      target: { value: 'Once only' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await fireEvent.click(screen.getByRole('button', { name: /Send|Sending…/ }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(jsonResponse(201, { id: 'f-2', created_at: '2026-07-23T00:00:00.000Z' }));
  });
});
