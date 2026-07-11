export interface AType {
  value: number;
}

export function makeA(value: number): AType {
  return { value };
}
