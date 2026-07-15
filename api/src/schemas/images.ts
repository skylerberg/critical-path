import { type } from 'arktype';

export const imageResponseSchema = type({
  id: 'string',
  url: 'string',
  filename: 'string',
  content_type: 'string',
  size_bytes: 'number',
  created_at: 'string',
});

export type ImageResponse = typeof imageResponseSchema.infer;
