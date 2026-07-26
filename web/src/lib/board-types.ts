import type { components, paths } from '../api/api.generated';
export type CycleTask = components['schemas']['CycleTask'];
export type BoardPayload =
  paths['/api/projects/{id}']['get']['responses']['200']['content']['application/json'];
export type BoardProject = BoardPayload['project'];
export type BoardColumn = BoardPayload['columns'][number];
export type BoardTask = BoardPayload['tasks'][number];
export type BoardLabel = BoardPayload['labels'][number];
export type PublicBoardPayload =
  paths['/api/public/projects/{id}/board']['get']['responses']['200']['content']['application/json'];
