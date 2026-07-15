import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, verifyDummyPassword } from '../../src/services/passwords';

describe('hashPassword', () => {
  it('produces an argon2id hash', async () => {
    const hash = await hashPassword('some-password');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('some-password');
  });

  it('produces distinct hashes for the same password (random salt)', async () => {
    const a = await hashPassword('some-password');
    const b = await hashPassword('some-password');
    expect(a).not.toBe(b);
  });
});

describe('verifyPassword', () => {
  it('verifies the correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'wrong password')).toBe(false);
  });

  it('returns false instead of throwing on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});

describe('verifyDummyPassword', () => {
  it('completes without throwing', async () => {
    await expect(verifyDummyPassword('any-password')).resolves.toBeUndefined();
  });
});
