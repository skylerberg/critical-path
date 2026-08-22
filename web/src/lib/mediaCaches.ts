import { AVATAR_CACHE_NAME, IMAGE_CACHE_NAME } from './constants';

// The service worker keeps board images and avatars on the device for weeks,
// and those bytes are now private — the routes that serve them require a
// credential. Leaving them in CacheStorage would mean signing out on a shared
// machine left the pictures behind, which is the thing requiring the credential
// was for.
export function clearMediaCaches(): void {
  if (typeof caches === 'undefined') return;
  for (const name of [IMAGE_CACHE_NAME, AVATAR_CACHE_NAME]) {
    // A CacheStorage that refuses is not worth reporting to someone who is on
    // their way out of the app either way.
    void caches.delete(name).catch(() => false);
  }
}
