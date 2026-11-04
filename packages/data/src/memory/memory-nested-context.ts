import type { NestedUnitOptions } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';
import type { MemoryUnitContext } from './memory-unit-context.ts';
import { memoryUnitContext } from './memory-unit-context.ts';

function refused(ctx: MemoryUnitContext, why: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'forbidden',
    code: 'core.forbidden',
    message: `a ${ctx.scope.level}-scope unit cannot open a nested unit ${why}`,
    details: { scope: ctx.scope.level },
  });
}

/**
 * The view a savepoint has (14.3.6). It shares the unit's copy-on-write collections and differs
 * in two things only: `readOnly` makes it refuse writes (and never widens a read-only unit), and
 * `as` re-points it at the unit's own backend, which only a tenant unit may do and only
 * read-only; every other `as` is `forbidden`.
 */
export function memoryNestedContext(
  ctx: MemoryUnitContext,
  options: NestedUnitOptions | undefined,
): MemoryUnitContext {
  const as = options?.as;
  const readOnly = ctx.readOnly || options?.readOnly === true;
  if (as === undefined) {
    return readOnly === ctx.readOnly ? ctx : memoryUnitContext({ ...ctx, readOnly }, ctx.entity);
  }
  const ownBackend =
    ctx.scope.level === 'tenant' && as.level === 'backend' && as.backendId === ctx.scope.backendId;
  if (!ownBackend) throw refused(ctx, 'for another scope');
  if (options?.readOnly !== true) throw refused(ctx, 'as its backend unless it is read-only');
  return memoryUnitContext({ ...ctx, scope: as, readOnly: true }, ctx.entity);
}
