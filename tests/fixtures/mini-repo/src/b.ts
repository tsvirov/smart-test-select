import { makeA } from './a.js';

export function makeB(value: number) {
  return makeA(value * 2);
}
