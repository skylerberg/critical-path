// Every schema module must be re-exported here: the OpenAPI schema-name
// registry derives component names from this barrel's named exports.
export * from './common';
export * from './errors';
export * from './auth';
export * from './users';
export * from './tiptap';
export * from './board';
export * from './projects';
export * from './workspaces';
export * from './columns';
export * from './tasks';
export * from './labels';
export * from './images';
