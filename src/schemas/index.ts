// Every schema module must be re-exported here: the OpenAPI schema-name
// registry derives component names from this barrel's named exports.
export * from './common';
export * from './errors';
export * from './auth';
export * from './sessions';
export * from './personalAccessTokens';
export * from './users';
export * from './notifications';
export * from './tiptap';
export * from './board';
export * from './projects';
export * from './export';
export * from './accountExport';
export * from './publicBoard';
export * from './columns';
export * from './tasks';
export * from './myTasks';
export * from './search';
export * from './labels';
export * from './images';
export * from './comments';
export * from './checklists';
export * from './activity';
export * from './feedback';
export * from './webhooks';
export * from './taskSeries';
