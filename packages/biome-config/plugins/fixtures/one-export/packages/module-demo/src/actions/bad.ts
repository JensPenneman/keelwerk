export const first = 1;
export const second = 2; // expect: plugin/one-export
export function third(): number { // expect: plugin/one-export
  return 3;
}
export class Fourth { // expect: plugin/one-export
  readonly value = 4;
}
