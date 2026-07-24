import { type } from 'arktype';
import { uuid, stringWithLength, optionalText } from './common';

export const createFeedbackSchema = type({
  id: uuid,
  message: stringWithLength(1, 10000),
  'page_path?': optionalText(500),
});

export const feedbackResponseSchema = type({
  id: 'string',
  created_at: 'string',
});

export type FeedbackResponse = typeof feedbackResponseSchema.infer;
