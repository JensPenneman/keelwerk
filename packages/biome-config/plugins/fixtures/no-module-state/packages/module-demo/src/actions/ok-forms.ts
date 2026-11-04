const epoch = Temporal.Instant.from('2026-11-04T00:00:00Z');
const names: readonly string[] = ['a'];

export function forms(items: number[], copy: { count: number }): number {
  copy.count++;
  const later = epoch.add({ hours: 1 });
  const local = { count: 0 };
  delete local.count;
  Object.assign(local, { count: 1 });
  items.map((names) => names + 1);
  return later.epochMilliseconds + names.length;
}
