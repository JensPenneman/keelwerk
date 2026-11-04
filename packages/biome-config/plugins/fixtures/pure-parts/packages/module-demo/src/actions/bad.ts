import type { Ctx } from '@keelwerk/core';

export function* bad(ctx: Ctx): Generator<unknown, number, unknown> {
  const a = Temporal.Now.instant(); // expect: plugin/pure-parts
  const b = Date.now(); // expect: plugin/pure-parts
  const c = new Date(); // expect: plugin/pure-parts
  const d = Math.random(); // expect: plugin/pure-parts
  const e = performance.now(); // expect: plugin/pure-parts
  const f = crypto.randomUUID(); // expect: plugin/pure-parts
  setTimeout(() => ctx, 1); // expect: plugin/pure-parts
  setInterval(() => ctx, 1); // expect: plugin/pure-parts
  queueMicrotask(() => ctx); // expect: plugin/pure-parts
  const g = fetch('https://example.com'); // expect: plugin/pure-parts
  const h = yield ctx.load.demo.item.one({}); // expect: plugin/pure-parts
  return [a, b, c, d, e, f, g, h].length;
}
