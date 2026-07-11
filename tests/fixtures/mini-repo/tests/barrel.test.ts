import { describe, expect, it } from 'vitest';
import { makeA, makeB } from '../src/barrel.js';

describe('barrel', () => {
  it('re-exports a and b', () => {
    expect(makeA(1).value).toBe(1);
    expect(makeB(1).value).toBe(2);
  });
});
