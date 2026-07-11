import type { AType } from './a.js';

export function formatA(a: AType): string {
  return `value=${a.value}`;
}
