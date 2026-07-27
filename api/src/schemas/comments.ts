import { type } from 'arktype';
import { uuid } from './common';
import { isEmptyTiptapDoc, tiptapDocSchema } from './tiptap';

// Never export: a morph falls back to its base shape, so a second exported
// doc-shaped schema collides with TiptapDoc and the name registry throws.
const commentBody = tiptapDocSchema.pipe((doc, ctx) =>
  isEmptyTiptapDoc(doc) ? ctx.error({ expected: 'a non-empty comment body', actual: '' }) : doc
);

export const createCommentSchema = type({
  id: uuid,
  task_id: uuid,
  body: commentBody,
});

export const patchCommentSchema = type({
  body: commentBody,
});

export const commentSchema = type({
  id: 'string',
  task_id: 'string',
  user_id: 'string',
  body: tiptapDocSchema,
  created_at: 'string',
  updated_at: 'string',
});

export type CommentResponse = typeof commentSchema.infer;
