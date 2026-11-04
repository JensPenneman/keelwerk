export async function send(): Promise<number> {
  const a = Temporal.Now.instant();
  const b = Date.now();
  const c = new Date();
  const d = Math.random();
  const e = performance.now();
  const f = crypto.randomUUID();
  await new Promise((resolve) => setTimeout(resolve, 1));
  const g = await fetch('https://example.com');
  queueMicrotask(() => a);
  return [a, b, c, d, e, f, g].length;
}
