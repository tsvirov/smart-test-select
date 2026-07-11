import { describe, expect, it } from 'vitest';
import { loadA } from '../src/literalDynamic.js';

describe('literalDynamic', () => {
  it('loads a dynamically', async () => {
    expect((await loadA()).value).toBe(1);
  });
});
