import { describe, expect, it } from 'vitest';
import { useHelper } from '../src/aliasConsumer.js';

describe('aliasConsumer', () => {
  it('uses helper via alias', () => {
    expect(useHelper(4)).toBe(5);
  });
});
