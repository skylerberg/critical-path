import { errorText } from '../../utils/errors';
import { logger } from '../../utils/logger';
import type { PublicContext } from '../../types/index';
import { storage } from './index';

const STORAGE_DELETE_BATCH = 25;

// Post-commit because a stored object cannot be rolled back: deleting it inside
// the transaction would strand every row still pointing at it if the write
// failed afterwards.
//
// Settled per key rather than awaited as one Promise.all, and batched because an
// account's keys are every image of every board it created: once the rows are
// gone, a key that fails is only recoverable from this log line, and a rejection
// that abandoned the rest of the batch would leak them with nothing recorded.
export function deleteStoredObjectsAfterCommit(
  c: Pick<PublicContext, 'get'>,
  keys: readonly string[]
): void {
  if (keys.length === 0) return;
  c.get('postCommitHooks').push(async () => {
    for (let start = 0; start < keys.length; start += STORAGE_DELETE_BATCH) {
      const batch = keys.slice(start, start + STORAGE_DELETE_BATCH);
      const results = await Promise.allSettled(batch.map((key) => storage.delete(key)));
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logger.error({
            msg: 'Deletion left a stored object behind',
            storageKey: batch[index],
            error: errorText(result.reason),
          });
        }
      });
    }
  });
}
