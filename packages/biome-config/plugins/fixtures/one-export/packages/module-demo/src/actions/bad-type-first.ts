const a = 1;
const b = 2;

export type U = number;
export { type U as V, a, b }; // expect: plugin/one-export
