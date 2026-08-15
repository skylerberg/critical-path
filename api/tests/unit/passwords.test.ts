import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, verifyDummyPassword } from '../../src/services/passwords';

const ENCODED_PARAMETERS = /^(\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+)\$/;

describe('hashPassword', () => {
  it('produces an argon2id hash', async () => {
    const hash = await hashPassword('some-password');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('some-password');
  });

  // Pinned exactly rather than as a floor. Below these the stored hashes are
  // cheap to attack; above them a real verify outlasts the fixed dummy hash
  // login falls back to, which is minted at exactly these parameters, and the
  // gap is an account-enumeration oracle.
  it('costs 64 MiB over three passes', async () => {
    const hash = await hashPassword('some-password');
    expect(ENCODED_PARAMETERS.exec(hash)?.[1]).toBe('$argon2id$v=19$m=65536,t=3,p=4');
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

  // Its entire job is to cost what a real verify costs, and verifyPassword
  // swallows the throw, so a dummy hash that stopped parsing would return
  // instantly and silently. Nothing running 64 MiB over three passes comes
  // back inside 10ms; a rejected malformed hash does.
  it('spends the work of a real verify rather than failing fast', async () => {
    const started = Date.now();
    await verifyDummyPassword('any-password');
    expect(Date.now() - started).toBeGreaterThan(10);
  });
});
