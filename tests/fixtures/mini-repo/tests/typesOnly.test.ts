import { describe, expect, it } from 'vitest';
import { makeA } from '../src/a.js';
import { formatA } from '../src/typesOnly.js';

describe('typesOnly', () => {
  it('formats a', () => {
    expect(formatA(makeA(5))).toBe('value=5');
  });
});
