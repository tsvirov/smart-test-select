import { describe, expect, it } from 'vitest';
import { makeB } from '../src/b.js';

describe('b', () => {
  it('doubles via a', () => {
    expect(makeB(3)).toEqual({ value: 6 });
  });
});
