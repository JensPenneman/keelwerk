import type { Ctx } from '@keelwerk/core';

export function* bad(ctx: Ctx): Generator<unknown, number, unknown> {
  const a = Date.now(); // expect: plugin/pure-parts
  const b = yield ctx.load.demo.item.one({}); // expect: plugin/pure-parts
  return [a, b].length;
}
