import { describe, it, expect } from 'vitest';
import {
  PERSONAL_ACCESS_TOKEN_PREFIX,
  generatePersonalAccessToken,
  isPersonalAccessToken,
} from '../../src/services/personalAccessTokens';
import { generateSessionToken } from '../../src/services/sessions';

describe('personal access tokens', () => {
  it('generates prefixed, unique, high-entropy secrets', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const token = generatePersonalAccessToken();
      expect(token.startsWith(PERSONAL_ACCESS_TOKEN_PREFIX)).toBe(true);
      expect(token.length - PERSONAL_ACCESS_TOKEN_PREFIX.length).toBeGreaterThanOrEqual(43);
      tokens.add(token);
    }
    expect(tokens.size).toBe(100);
  });

  it('recognizes its own tokens and not session tokens', () => {
    expect(isPersonalAccessToken(generatePersonalAccessToken())).toBe(true);
    expect(isPersonalAccessToken(generateSessionToken())).toBe(false);
  });
});
