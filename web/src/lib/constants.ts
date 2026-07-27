export const APP_NAME = 'Critical Path';

// The service worker labels its runtime caches with these, and account deletion
// clears them by name; one owner is what keeps the two from drifting apart.
export const IMAGE_CACHE_NAME = 'api-images';
export const AVATAR_CACHE_NAME = 'api-avatars';
