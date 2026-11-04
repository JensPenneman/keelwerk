import type { Ctx } from '@keelwerk/core';

export function* ok(ctx: Ctx): Generator<unknown, number, unknown> {
  const a = ctx.clock.now();
  const b = new Date(0);
  const c = Date.parse('2026-11-04');
  const d = ctx.newId('item');
  const e = Temporal.Instant.from('2026-11-04T00:00:00Z');
  const f = ctx.http.fetch('https://example.com');
  const g = yield* ctx.load.demo.item.one({});
  return [a, b, c, d, e, f, g].length;
}
