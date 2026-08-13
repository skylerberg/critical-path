import { api, assertOk } from '../api/client';
import { apiMessage } from './apiMessages';
import type { BoardPort } from './board-port';
import type { TaskAttachment } from './board-types';
import { saveBlob } from './export';
import { nowIso } from './dates';
import { patchById, removeById } from './collections';
import { newId } from './ids';
import { toasts } from './toasts.svelte';

export class BoardAttachments {
  byTask = $state<Record<string, TaskAttachment[]>>({});

  readonly #board: BoardPort;

  constructor(board: BoardPort) {
    this.#board = board;
  }

  setCount(taskId: string, next: (current: number) => number): void {
    this.#board.setTasks(
      this.#board
        .tasks()
        .map((task) =>
          task.id === taskId
            ? { ...task, attachment_count: Math.max(0, next(task.attachment_count ?? 0)) }
            : task
        )
    );
  }

  // A no-op when the list is not cached, for the same reason the comment stream
  // is — see BoardComments.replace.
  replace(taskId: string, next: (attachments: TaskAttachment[]) => TaskAttachment[]): void {
    const cached = this.byTask[taskId];
    if (cached === undefined) {
      return;
    }
    this.byTask = { ...this.byTask, [taskId]: next(cached) };
  }

  async upload(taskId: string, file: File): Promise<TaskAttachment | null> {
    try {
      const attachment = assertOk(
        await api.POST('/api/attachments/files', {
          params: {
            query: {
              task_id: taskId,
              filename: file.name || 'attachment',
              content_type: file.type || 'application/octet-stream',
            },
          },
          // The file is the body, so it is handed to fetch untouched: serializing
          // it would read the whole thing into memory on both ends of the wire.
          body: file as unknown as string,
          bodySerializer: (body: unknown) => body as BodyInit,
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      );
      // The realtime echo can land before this response does and append it already.
      const cached = this.byTask[taskId] ?? [];
      if (!cached.some((existing) => existing.id === attachment.id)) {
        this.byTask = { ...this.byTask, [taskId]: [...cached, attachment] };
        this.setCount(taskId, (count) => count + 1);
      }
      return attachment;
    } catch (error) {
      toasts.error(apiMessage(error, 'Attachment upload failed'));
      return null;
    }
  }

  async addLink(taskId: string, url: string): Promise<void> {
    const id = newId();
    const now = nowIso();
    const optimistic: TaskAttachment = {
      id,
      task_id: taskId,
      kind: 'link',
      // A link is neither an image nor a cover.
      image_url: null,
      is_cover: false,
      title: null,
      description: null,
      filename: null,
      content_type: null,
      size_bytes: null,
      url,
      preview_url: null,
      favicon_url: null,
      unfurl_state: 'pending',
      created_at: now,
      updated_at: now,
    };
    this.byTask = {
      ...this.byTask,
      [taskId]: [...(this.byTask[taskId] ?? []), optimistic],
    };
    this.setCount(taskId, (count) => count + 1);
    try {
      const created = assertOk(
        await api.POST('/api/attachments/links', { body: { id, task_id: taskId, url } })
      );
      this.replace(taskId, (attachments) => patchById(attachments, id, () => created));
    } catch (error) {
      await this.#board.detailMutationFailed(taskId, error);
    }
  }

  async patch(
    taskId: string,
    id: string,
    patch: { title?: string | null; description?: string | null }
  ): Promise<void> {
    this.replace(taskId, (attachments) =>
      patchById(attachments, id, (attachment) => ({ ...attachment, ...patch }))
    );
    try {
      const updated = assertOk(
        await api.PATCH('/api/attachments/{id}', { params: { path: { id } }, body: patch })
      );
      this.replace(taskId, (attachments) => patchById(attachments, id, () => updated));
    } catch (error) {
      await this.#board.detailMutationFailed(taskId, error);
    }
  }

  async remove(taskId: string, id: string): Promise<void> {
    // The cover lives on the row, so removing that row takes the cover with it;
    // the card would otherwise keep pointing at bytes that are gone.
    const removed = (this.byTask[taskId] ?? []).find((entry) => entry.id === id);
    if (removed?.is_cover === true) {
      this.#board.setTasks(
        patchById(this.#board.tasks(), taskId, (task) => ({ ...task, cover_image_url: null }))
      );
    }
    this.replace(taskId, (attachments) => removeById(attachments, id));
    this.setCount(taskId, (count) => count - 1);
    try {
      assertOk(await api.DELETE('/api/attachments/{id}', { params: { path: { id } } }));
    } catch (error) {
      await this.#board.detailMutationFailed(taskId, error);
    }
  }

  async download(attachment: TaskAttachment): Promise<void> {
    try {
      const blob = assertOk(
        await api.GET('/api/attachments/{id}/download', {
          params: { path: { id: attachment.id } },
          parseAs: 'blob',
        })
      );
      saveBlob(blob as Blob, attachment.filename ?? 'attachment');
    } catch (error) {
      toasts.error(apiMessage(error, 'Download failed'));
    }
  }

  // Takes the attachment rather than its id so the store never rebuilds the URL
  // the server owns, and flips is_cover on the list it just moved the flag on.
  async setCover(taskId: string, image: TaskAttachment | null): Promise<void> {
    this.#board.setTasks(
      patchById(this.#board.tasks(), taskId, (task) => ({
        ...task,
        cover_image_url: image?.image_url ?? null,
      }))
    );
    this.replace(taskId, (attachments) =>
      attachments.map((entry) =>
        entry.kind === 'image' ? { ...entry, is_cover: entry.id === image?.id } : entry
      )
    );
    await this.#board.sendOrFail({
      entityId: taskId,
      label: image === null ? 'Removed a cover image' : 'Set a cover image',
      request: {
        method: 'PUT',
        path: '/api/tasks/{id}/cover',
        pathParams: { id: taskId },
        body: { image_id: image?.id ?? null },
      },
    });
  }
}
