import type { paths } from '../api/api.generated';
export type BoardPayload =
  paths['/api/projects/{id}']['get']['responses']['200']['content']['application/json'];
export type BoardProject = BoardPayload['project'];
export type BoardColumn = BoardPayload['columns'][number];
export type BoardTask = BoardPayload['tasks'][number];
export type BoardLabel = BoardPayload['labels'][number];
