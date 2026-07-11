import { describe, expect, it } from 'vitest';
import { untouched } from '../src/untouched.js';

describe('untouched', () => {
  it('returns untouched', () => {
    expect(untouched()).toBe('untouched');
  });
});
