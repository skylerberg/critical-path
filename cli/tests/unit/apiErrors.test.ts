import { describe, it, expect } from 'vitest';
import { ApiError, assertOk } from '../../src/api/errors';

const CYCLE_ERROR = 'Adding this blocker would create a dependency cycle';

function failing(status: number, body: unknown) {
  return { error: body, response: new Response(null, { status }) };
}

function messageFor(status: number, body: unknown): string {
  try {
    assertOk(failing(status, body));
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(status);
    return (err as ApiError).message;
  }
  throw new Error('assertOk did not throw');
}

describe('assertOk error messages', () => {
  it('names the loop when the 409 body carries a cycle', () => {
    const cycle = [
      { id: '1', title: 'Plan' },
      { id: '2', title: 'Build' },
      { id: '1', title: 'Plan' },
    ];
    expect(messageFor(409, { error: CYCLE_ERROR, cycle })).toBe(
      `${CYCLE_ERROR}: Plan -> Build -> Plan`
    );
  });

  it('falls back to the plain message when the server sends no cycle', () => {
    expect(messageFor(409, { error: CYCLE_ERROR })).toBe(CYCLE_ERROR);
  });

  it('falls back to the plain message for an empty cycle', () => {
    expect(messageFor(409, { error: CYCLE_ERROR, cycle: [] })).toBe(CYCLE_ERROR);
  });

  it('falls back to the plain message for a malformed cycle entry', () => {
    const cycle = [{ id: '1', title: 'Plan' }, { id: '2' }, { id: '1', title: 'Plan' }];
    const message = messageFor(409, { error: CYCLE_ERROR, cycle });
    expect(message).toBe(CYCLE_ERROR);
    expect(message).not.toContain('undefined');
  });

  it('leaves validation details untouched', () => {
    const details = [{ path: 'title', message: 'is required' }];
    expect(messageFor(422, { error: 'Validation failed', details, cycle: [{ title: 'X' }] })).toBe(
      'Validation failed: title: is required'
    );
  });

  it('falls back to the status when the body carries nothing usable', () => {
    expect(messageFor(500, null)).toBe('Request failed with status 500');
  });
});
