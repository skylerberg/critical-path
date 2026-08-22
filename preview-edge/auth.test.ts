import assert from 'node:assert/strict';
import { test } from 'node:test';

import { authorized, PLACEHOLDER_CREDENTIAL } from './auth.ts';

const SECRET = 'preview:s3cr3t';
const header = (credential: string): string =>
  `Basic ${Buffer.from(credential, 'utf8').toString('base64')}`;

test('no Authorization header is denied', () => {
  assert.equal(authorized(undefined, SECRET), false);
});

const MALFORMED = ['', 'Basic', 'Bearer abc', 'Basic ', 'Basic !!!not base64!!!', 'Basic ===='];

test('a malformed Authorization header is denied without throwing', () => {
  for (const value of MALFORMED) {
    const label = JSON.stringify(value);
    assert.equal(authorized(value, SECRET), false, `expected ${label} to be denied`);
  }
});

test('the wrong credential is denied', () => {
  assert.equal(authorized(header('preview:wrong'), SECRET), false);
  assert.equal(authorized(header('preview:s3cr3t '), SECRET), false);
  assert.equal(authorized(header('preview:'), SECRET), false);
});

test('the right credential is admitted', () => {
  assert.equal(authorized(header(SECRET), SECRET), true);
  // The scheme token is case-insensitive per RFC 7235; curl and browsers both
  // send "Basic", but nothing guarantees the next client does.
  assert.equal(authorized(header(SECRET).replace('Basic', 'basic'), SECRET), true);
});

// The whole point of the change: an unconfigured gate closes rather than opens.
test('an unset or placeholder secret denies every request', () => {
  for (const secret of [undefined, '', PLACEHOLDER_CREDENTIAL]) {
    assert.equal(authorized(header(SECRET), secret), false);
    assert.equal(authorized(undefined, secret), false);
  }
  // Including a client that presents the placeholder value itself.
  assert.equal(authorized(header(PLACEHOLDER_CREDENTIAL), PLACEHOLDER_CREDENTIAL), false);
});
