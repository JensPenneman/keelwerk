import { inlineEffectId } from '../effects/inline-effect-id.ts';
import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import { isFinishedReceipt } from '../write-path/is-finished-receipt.ts';
import { isUnexpiredReceipt } from '../write-path/is-unexpired-receipt.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import { isExemptFromAdmission } from './is-exempt-from-admission.ts';
import { quotaExceeded } from './quota-exceeded.ts';
import { storageLimits } from './storage-limits.ts';

/**
 * The admission of a command with a `prepare` step (12.2): before `prepare` runs, and so before its
 * inline effects do, for each command id until its first attempt has left a finished, unexpired
 * receipt or an effect record. A command id that is new (no finished, unexpired receipt and no
 * effect record) of a scope that stands above a storage limit, in `core.eventBytes` or in
 * `core.rows`, is refused with `core.quota_exceeded` and nothing of the command starts, whatever
 * its decision would store: the admission cannot know that, and a `prepare` that ran for a command
 * that is then refused is what it exists to prevent. The storage limits are checked in one place
 * for the command a unit is opened for, and what runs nested in that unit follows that command: a
 * command with `prepare` here and never at the commit tail of its unit, a command without `prepare`
 * that a unit is opened for at the commit tail of that unit only, in a dimension that its commit
 * adds to, and that refusal is pinned to the command id as a failed receipt. What that does not
 * say: a core action is checked in neither place; a dry run ends in a unit that always rolls back,
 * so no limit refuses it; an asynchronous command is accepted first, and its accept stores its
 * receipt and change record, which no limit refuses.
 *
 * With no limit (a core action, no quotas, a deployment scope) no unit opens. Otherwise one
 * read-only unit of the run's scope reads the receipt of the command id:
 * - A finished receipt that has not expired answers a resend, which is never refused by a storage
 *   limit and never charged a second time, so the run goes on with `replayOnly` (its `prepare`
 *   answers from the effect rows it stored, and starts no effect).
 * - Else the counters are read, `core.eventBytes` first. With none above its limit the command is
 *   admitted (equal to the limit admits: only a unit that ends above a limit is refused at a tail).
 * - A counter above its limit refuses the command, unless the first effect record of its id
 *   exists. The first attempt of this id committed it, so the id was admitted before: it is
 *   admitted once, never refused by the admission again and charged nothing. It goes the path it
 *   goes with no admission at all: an effect still `requested` is the retryable
 *   `core.command_in_progress`, a settled one answers from its row, for the same caller and
 *   request, and the run goes on to its decision (`answerInlineRow`).
 *   Effects are performed in order (`runPrepare`), so the record of index 0 exists whenever any
 *   does.
 *
 * What an admitted or resumed command meets after that: nothing from a storage limit. The commit
 * tail of the unit opened for a command with `prepare` declares no storage limit
 * (`isUnitExemptFromTail`, `isExemptFromTail`, 12.2): it charges what the unit stores, whichever
 * action charges it (the decision, its inline reactions, every synchronous command invoked in the
 * unit and their inline reactions), and the decision is stored whatever the counters are by then,
 * so an effect that ran is never left without its decision, and no refusal of such a command is
 * pinned to its id.
 *
 * What overshoots a limit is therefore everything the unit of every command with `prepare` stores,
 * for a command that was admitted while no counter stood above its limit and is in flight, or is
 * resumed from an effect record, when a limit is crossed: the effect records, the decision, its
 * inline reactions and the synchronous commands invoked in the unit with theirs. No fixed number
 * bounds them, they are the commands of that kind in flight or resumable at that moment. The
 * records of the framework's own units overshoot too. An id with an effect record goes on with
 * another request as long as the caller and the input of its first effect are the same (the
 * contract of command ids, not of the limits); per id the bound is the performs of one `prepare`
 * run that its first attempt had not begun, and one decision with what its unit stores, while the
 * effect record lives. The counters are read without a lock, and a resend that arrives after its
 * first attempt was admitted and before that attempt has committed its first effect record (for a
 * `prepare` that performs none, its receipt), at a moment when a counter has since risen above its
 * limit, is refused: it finds no receipt and no effect record. The caller sees a non-retryable
 * `core.quota_exceeded` although the first attempt can still complete; a resend after that commit
 * is admitted on its effect record or answered from its receipt. The limits come from the quota
 * cache, and a command that starts before the cache has read new limits sees the old ones. A
 * refusal comes before `runCommand`, so it is not pinned to the command id. A host that calls
 * `runCommand` without this admission has no storage check for such a command at all.
 */
export async function admitPrepare(input: RunCommandInput): Promise<RunCommandInput> {
  const { action, registry, scope, quotas } = input;
  if (action.prepare === undefined) return input;
  const limits = storageLimits({ registry, scope, quotas, exempt: isExemptFromAdmission(action) });
  if (limits === null) return input;
  const { commandId } = input;
  const now = input.clock.now();
  const effect = registry.entities.get('core.effect')?.descriptor;
  return input.adapter.unit(
    input.namespace,
    scope,
    async (unit) => {
      const receipt = commandId === undefined ? undefined : await unit.receipts.get(commandId);
      if (receipt !== undefined && isUnexpiredReceipt(receipt, now) && isFinishedReceipt(receipt)) {
        return { ...input, replayOnly: true };
      }
      const eventBytes = await unit.usage.get('core.eventBytes');
      const rows = await unit.usage.get('core.rows');
      let refusal: KeelwerkError | undefined;
      if (eventBytes > limits.eventBytes) {
        refusal = quotaExceeded('core.eventBytes', limits.eventBytes, eventBytes);
      } else if (rows > limits.rows) {
        refusal = quotaExceeded('core.rows', limits.rows, rows);
      }
      if (refusal === undefined) return input;
      if (commandId !== undefined && effect !== undefined) {
        const first = await unit.rows.findOne(effect, {
          where: { op: 'eq', field: 'id', value: inlineEffectId(scope, commandId, 0) },
        });
        if (first !== undefined) return input;
      }
      throw refusal;
    },
    { readOnly: true, ...(input.signal === undefined ? {} : { signal: input.signal }) },
  );
}
