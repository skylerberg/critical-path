import '../api/testUtils';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { apiMessage } from './apiMessages';

describe('apiMessage', () => {
  it('prefers the server’s own words to the fallback', () => {
    expect(apiMessage(new ApiError(409, 'That name is already taken'))).toBe(
      'That name is already taken'
    );
    expect(apiMessage(new ApiError(409, 'That name is already taken'), 'Could not save')).toBe(
      'That name is already taken'
    );
  });

  // A fetch that never landed rejects as a TypeError carrying nothing worth
  // showing, which is the case the default exists for.
  it('falls back for anything that is not an ApiError', () => {
    expect(apiMessage(new TypeError('Failed to fetch'))).toBe(
      'Could not reach the server. Check your connection and try again.'
    );
    expect(apiMessage(new Error('boom'))).toBe(
      'Could not reach the server. Check your connection and try again.'
    );
  });

  it('falls back for non-errors, including the ones a thrown value can be', () => {
    for (const thrown of [null, undefined, 'a string', 0, { status: 500 }]) {
      expect(apiMessage(thrown)).toBe(
        'Could not reach the server. Check your connection and try again.'
      );
    }
  });

  it('uses the caller’s fallback when one is given', () => {
    expect(apiMessage(new TypeError('Failed to fetch'), 'Could not archive that card')).toBe(
      'Could not archive that card'
    );
  });

  // A subclass is still an ApiError; nothing here narrows on the name.
  it('reads the status-derived message assertOk builds', () => {
    expect(apiMessage(new ApiError(500, 'Request failed with status 500'))).toBe(
      'Request failed with status 500'
    );
  });
});
