import type { Ctx } from '@keelwerk/core';
import { run } from './run.ts';

export async function ok(ctx: Ctx): Promise<void> {
  run();
  await Promise.resolve(ctx);
  if (ctx) {
    run();
  }
}
