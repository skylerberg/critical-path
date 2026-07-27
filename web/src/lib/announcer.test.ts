import { afterEach, describe, expect, it } from 'vitest';
import { announcer } from './announcer.svelte';

afterEach(() => {
  announcer.clear();
});

describe('announcer', () => {
  it('leaves the region empty until the flush after the call', async () => {
    const pending = announcer.announce('Moved "Design cards" to Done, position 3 of 3');

    expect(announcer.message).toBe('');
    await pending;
    expect(announcer.message).toBe('Moved "Design cards" to Done, position 3 of 3');
  });

  it('blanks the region between identical announcements so a repeat is read again', async () => {
    await announcer.announce('Moved "Design cards" to Done, position 3 of 3');

    const repeat = announcer.announce('Moved "Design cards" to Done, position 3 of 3');
    expect(announcer.message).toBe('');
    await repeat;
    expect(announcer.message).toBe('Moved "Design cards" to Done, position 3 of 3');
  });

  it('clears the region', async () => {
    await announcer.announce('Moved "Design cards" to Done, position 3 of 3');

    announcer.clear();

    expect(announcer.message).toBe('');
  });
});
