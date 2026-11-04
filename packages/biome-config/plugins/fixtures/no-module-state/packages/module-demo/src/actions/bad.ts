let counter = 0; // expect: plugin/no-module-state
var legacy = 1; // expect: plugin/no-module-state
const cache = new Map<string, number>();
const items: number[] = [];
const state = { count: 0, nested: { n: 1 } };

export function mutate(key: string): number {
  counter += 1;
  items.push(1); // expect: plugin/no-module-state
  cache.set(key, 1); // expect: plugin/no-module-state
  cache.delete(key); // expect: plugin/no-module-state
  state.count = 2; // expect: plugin/no-module-state
  state.nested.n += 1; // expect: plugin/no-module-state
  state[key] = 3; // expect: plugin/no-module-state
  return counter + legacy;
}
