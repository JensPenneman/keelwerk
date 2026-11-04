const table = new Map<string, number>([['a', 1]]);
const names: readonly string[] = ['a', 'b'];

export function read(key: string, items: number[]): number {
  let local = 0;
  const copy = [...names];
  const own: number[] = [];
  copy.push('c');
  own.push(1);
  items.push(1);
  for (let i = 0; i < copy.length; i += 1) {
    local += i;
  }
  return (table.get(key) ?? 0) + local;
}
