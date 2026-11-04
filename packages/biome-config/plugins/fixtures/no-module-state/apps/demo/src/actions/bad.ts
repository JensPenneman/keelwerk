const pending: string[] = [];

export function enqueue(job: string): number {
  pending.push(job); // expect: plugin/no-module-state
  return pending.length;
}
