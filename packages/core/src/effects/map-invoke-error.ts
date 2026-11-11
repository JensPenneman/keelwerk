import { coreErrorCodes } from '../errors/core-error-codes.ts';
import { createError } from '../errors/create-error.ts';
import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';
import { isUniqueConflict } from '../errors/is-unique-conflict.ts';
import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { InvokeEffect } from '../protocol/invoke-effect.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { RetryableUnitError } from '../storage/retryable-unit-error.ts';

/** The cause kept on a projected error: names the invoked action and its code, holds the failure itself. */
function causeOf(effect: InvokeEffect, code: string, failure: unknown): Error {
  return new Error(`the invoked action "${effect.action}" failed with ${code}`, { cause: failure });
}

/**
 * The markers of the kernel's own retry that survive the projection, and nothing else of the
 * details: a unique-index violation (`unique`, so the caller's unit is repeated once and `decide`
 * sees the committed row) and a version conflict the invoked command asked for (`ifVersion`, so the
 * unit is not repeated for nothing). Never the constraint name or any other detail.
 */
function retryMarkers(error: KeelwerkError): { readonly [marker: string]: true } | undefined {
  if (isUniqueConflict(error)) return { unique: true };
  const details = error.details as { readonly ifVersion?: boolean } | undefined;
  if (error.code === 'core.version_mismatch' && details?.ifVersion === true) {
    return { ifVersion: true };
  }
  return undefined;
}

/**
 * What a failure of an invoked command becomes for the caller (7.4). A code the effect's `errors`
 * map names becomes the caller's own declared error: its kind, message and retryable from the
 * declaration (`createError`), the original as `cause`. Any other keelwerk error reaches the caller
 * as the closed projection only: its kind, its code when that is a core code (else `core.<kind>`),
 * `retryable` and `retryAfter`, with the registered message of that code. The invoked command's own
 * message, issue paths and details are never passed on: they may quote a value the caller was not
 * allowed to read, a personal value among them; the failure stays on the error as its `cause` (for
 * the operator's log only, naming the invoked action and its code). Only the kernel's retry markers
 * of the details pass on (`retryMarkers`). An adapter's `RetryableUnitError` passes through
 * unchanged: it is the signal to repeat the caller's unit (14.3.6), never a failure of the invoked
 * command. Any other error that is no keelwerk error is a bug of the invoked command: it becomes
 * `core.internal`.
 */
export function mapInvokeError(error: unknown, effect: InvokeEffect, caller: ActionEntry): unknown {
  if (error instanceof RetryableUnitError) return error;
  if (!isKeelwerkError(error)) {
    // A bug in the invoked command: the caller fails `internal` and the log can find the cause.
    return createError(
      'internal',
      'core.internal',
      coreErrorCodes['core.internal'].message,
      undefined,
      {
        cause: causeOf(effect, 'core.internal', error),
      },
    );
  }
  const named =
    effect.errors !== undefined && Object.hasOwn(effect.errors, error.code)
      ? effect.errors[error.code]
      : undefined;
  const spec = named === undefined ? undefined : caller.errorSpecs?.[named];
  if (named !== undefined && spec !== undefined) {
    // An error named as itself passes its own details on: one definition, declared by both.
    const details = named === error.code && spec.data !== undefined ? error.details : undefined;
    return createError(spec.kind, named, spec.message, details, { cause: error }, spec.retryable);
  }
  const code = Object.hasOwn(coreErrorCodes, error.code) ? error.code : `core.${error.kind}`;
  const registered = Reflect.get(coreErrorCodes, code) as { readonly message: string };
  // The cause is for the operator's log alone (an internal failure is logged with it): it names the
  // invoked action and its code, and no answer, receipt, attempt record or job history carries it.
  return createError(error.kind, code, registered.message, retryMarkers(error), {
    cause: causeOf(effect, error.code, error),
    retryable: error.retryable,
    ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
  });
}
