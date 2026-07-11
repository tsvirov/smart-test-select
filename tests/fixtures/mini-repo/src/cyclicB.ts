import type { AFn } from './cyclicA.js';

export function fromB(fn?: AFn): string {
  return fn ? 'B(with fn)' : 'B';
}
