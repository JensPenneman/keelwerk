const state = { count: 0, key: 1, nested: { n: 1 } };
const items: number[] = [];
const tags = new Set<string>();

export function forms(xs: readonly number[], tag: string, ready: boolean): number {
  state.count++; // expect: plugin/no-module-state
  --state.nested.n; // expect: plugin/no-module-state
  delete state.key; // expect: plugin/no-module-state
  Object.assign(state, { count: 1 }); // expect: plugin/no-module-state
  xs.map((items) => items.valueOf());
  items.push(1); // expect: plugin/no-module-state
  if (ready) {
    const tags = new Set<string>();
    void tags;
  }
  tags.add(tag); // expect: plugin/no-module-state
  return xs.length;
}
