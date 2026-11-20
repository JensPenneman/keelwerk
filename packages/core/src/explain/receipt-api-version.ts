import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { Scope } from '../storage/scope.ts';

/**
 * The API version a command's receipt recorded (the version its digest covers), read in a unit of
 * its own; undefined when the receipt is gone (retention purged it). A command that ran as a
 * reaction job has an empty version, which is the one its digest holds.
 */
export async function receiptApiVersion(
  target: ScopeTarget,
  scope: Scope,
  commandId: string,
): Promise<string | undefined> {
  const receipt = await target.handle.adapter.unit(
    target.namespace,
    scope,
    (unit) => unit.receipts.get(commandId),
    { readOnly: true },
  );
  return receipt?.apiVersion;
}
