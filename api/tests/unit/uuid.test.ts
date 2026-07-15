import { describe, it, expect } from 'vitest';
import { isValidUuid, toUuid } from '../../src/types/uuid';

describe('isValidUuid', () => {
  it('returns true for valid lowercase UUID', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('returns true for valid uppercase UUID', () => {
    expect(isValidUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('returns true for mixed-case UUID', () => {
    expect(isValidUuid('550e8400-E29B-41d4-a716-446655440000')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidUuid('')).toBe(false);
  });

  it('returns false for UUID missing a character', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716-44665544000')).toBe(false);
  });

  it('returns false for invalid hex character', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716-44665544000g')).toBe(false);
  });

  it('returns false for UUID without hyphens', () => {
    expect(isValidUuid('550e8400e29b41d4a716446655440000')).toBe(false);
  });
});

describe('toUuid', () => {
  it('returns lowercased UUID for uppercase input', () => {
    expect(toUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000'
    );
  });

  it('returns same string for already-lowercase UUID', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(toUuid(uuid)).toBe(uuid);
  });

  it('throws for invalid input', () => {
    expect(() => toUuid('not-a-uuid')).toThrow('Invalid UUID');
  });

  it('throws for empty string', () => {
    expect(() => toUuid('')).toThrow('Invalid UUID');
  });
});
