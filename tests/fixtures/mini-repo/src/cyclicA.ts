import { fromB } from './cyclicB.js';

export type AFn = () => string;

export function fromA(): string {
  return `A+${fromB(fromA)}`;
}
