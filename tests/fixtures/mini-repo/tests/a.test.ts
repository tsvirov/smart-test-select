import { describe, expect, it } from 'vitest';
import { makeA } from '../src/a.js';

describe('a', () => {
  it('makes an A', () => {
    expect(makeA(2)).toEqual({ value: 2 });
  });
});
