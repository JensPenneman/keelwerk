import type { ControlStore } from '../control/control-store.ts';
import { runControlCommand } from '../control/run-control-command.ts';
import type { Id } from '../ids/id.ts';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import type { UnitGuard } from '../storage/guard-units.ts';
import { guardUnits } from '../storage/guard-units.ts';
import { flagScrubCommandId } from './flag-scrub-command-id.ts';
import { scrubFlagTargeting } from './scrub-flag-targeting.ts';

/**
 * Step 5b of section 14.7.5, in one writing deployment unit of the control store: removes
 * `subjectId` from the `principals` of every rule in `targeting` and in `previous` of each
 * `core.flag` row that names it, drops a rule left with no criterion, and writes the rows through
 * the `core.flag` write path as one command whose id is `flagScrubCommandId`, so a repeat after a crash answers the first run and no other
 * erasure does (a command id is unique in one scope only, and the identity, `erasureKey`, is the
 * tenant, the command id and the canonical subject). Answers the rows changed (0 once none names
 * the subject). With `guard`, every unit it opens runs its work through the guard, inside the
 * unit, so a scrub abandoned at a deadline writes nothing.
 */
export async function scrubFlagPrincipals(
  control: ControlStore,
  record: Pick<ErasureRecord, 'tenantId' | 'commandId' | 'subjectId'>,
  options: { readonly guard?: UnitGuard } = {},
): Promise<number> {
  const { subjectId } = record;
  const rows = await control.flags.rows();
  const changed = rows
    .map((row) => ({
      id: row.id,
      targeting: scrubFlagTargeting(row.targeting, subjectId),
      previous:
        row.previous === undefined ? undefined : scrubFlagTargeting(row.previous, subjectId),
      row,
    }))
    .filter((item) => item.targeting !== item.row.targeting || item.previous !== item.row.previous);
  if (changed.length === 0) return 0;
  const { guard } = options;
  await runControlCommand(
    guard === undefined ? control : { ...control, adapter: guardUnits(control.adapter, guard) },
    'eraseFlagTargets',
    function* (ctx) {
      const drafts = [];
      for (const item of changed) {
        const current = yield* ctx.load.core.flag.one({
          where: { id: item.id as Id<'core.flag'> },
        });
        if (current === undefined) continue;
        drafts.push(
          ctx.write.core.flag.update(current, {
            ...(item.targeting === item.row.targeting ? {} : { targeting: item.targeting }),
            ...(item.previous === item.row.previous ? {} : { previous: item.previous }),
          } as never),
        );
      }
      return drafts;
    },
    undefined,
    { commandId: flagScrubCommandId(record) },
  );
  return changed.length;
}
