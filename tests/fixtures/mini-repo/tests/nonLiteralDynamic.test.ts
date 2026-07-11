import { describe, expect, it } from 'vitest';
import { loadDynamic } from '../src/nonLiteralDynamic.js';

describe('nonLiteralDynamic', () => {
  it('is a function', () => {
    expect(typeof loadDynamic).toBe('function');
  });
});
