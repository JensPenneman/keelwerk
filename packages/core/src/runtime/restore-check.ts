import type { AnchorRecord } from '../anchors/newest-anchors.ts';
import { createRestoreHold } from '../control/create-restore-hold.ts';
import type { EpochBump } from '../control/epoch-bump.ts';
import { reenqueueUnsettledEffects } from '../control/reenqueue-unsettled-effects.ts';
import type { RestoreHold } from '../control/restore-hold.ts';
import type { Clock } from '../kernel/clock.ts';
import type { LedgerSink } from '../kernel/ledger-sink.ts';
import type { Logger } from '../observability/logger.ts';
import { queueSources } from '../worker/queue-sources.ts';
import { anchorScopes } from './anchor-scopes.ts';
import { applyNamespace } from './apply-namespace.ts';
import type { Connected } from './connected.ts';
import { type DecidedNamespace, decideNamespace } from './decide-namespace.ts';
import type { Migrated } from './migrate-phase.ts';
import { readSinks } from './read-sinks.ts';
import { replayLedger } from './replay-ledger.ts';
import type { ServedApp } from './served-app.ts';

/**
 * Detects a restore at `connect`, in the order of section 14.7.6 (D5 of WP-111), after `migrate` and
 * before anything serves; the control namespace was checked earlier, in `connect` before its first
 * write (`checkControlNamespace`), and is compared once more here against the sinks' anchors:
 * (a) per namespace of the process, `decideNamespace` compares the recorded identity, the marks, the
 *     counters and the newest anchors (a mark of a scope the directory places in another namespace
 *     is left alone: `departedScopes`);
 * (b) and (d) the ledger replay (`replayLedger`): the union with the sinks and the value keys of the
 *     tenants a restore touched; the sinks are read once (`readSinks`) for the anchors of (a) and
 *     the records of (b), and an unreadable sink fails the start;
 * (e) the effect jobs of every scope decided to be bumped, for each effect left requested;
 * then `applyNamespace` carries each bump out: the mark's compare-and-set, the counters raised, the
 *     identity and the marks recorded. (b), (d) and (e) do not depend on the new epoch, so they run
 *     before it: a crash or a failure up to here leaves the restore detectable at the next start,
 *     and every failure of them fails the start;
 * (c) and (f) the data keys of the unfinished erasures, and the hold: every tenant with an erasure
 *     left to run (a restore made it run again, or it is still pending) is not served until each
 *     has a completion at the current epoch (`replayLedger` collects them while it pages the
 *     unfinished erasures, after the bump so that the epoch it compares is the new one).
 * Each bump is logged at warn. A failure of (a) fails the start: nothing serves from counters that
 * may be rewound.
 */
export async function restoreCheck(input: {
  readonly connected: Connected;
  readonly migrated: Migrated;
  readonly served: readonly ServedApp[];
  readonly sinks: readonly LedgerSink[];
  readonly clock: Clock;
  readonly log: Logger;
}): Promise<{
  readonly bumps: readonly EpochBump[];
  readonly hold: RestoreHold;
  /** The newest anchor per scope the sinks held at this read, for the anchor writer to start from. */
  readonly anchors: ReadonlyMap<string, AnchorRecord>;
}> {
  const { connected, migrated, served, sinks, clock, log } = input;
  const { control } = connected;
  const apps = new Map(served.map((app) => [app.id, app] as const));
  const sources = await queueSources({ connected, apps });
  const directory = migrated.directory.lookup;
  await control.marks.bumped();

  // (a) Detect.
  const identities = new Map((await control.identities.all()).map((row) => [row.namespaceId, row]));
  // Each sink is read once for the whole check: the anchors here, the records for the replay.
  const { anchors: newest, records } = await readSinks(sinks);
  const anchored =
    newest.size === 0 ? new Map() : await anchorScopes(connected, migrated, new Set(newest.keys()));
  const now = clock.now();
  const decisions: DecidedNamespace[] = [];
  for (const source of sources) {
    const anchors = new Map<string, bigint>();
    for (const [scopeId, record] of newest) {
      if (anchored.get(scopeId)?.namespace.id === source.namespace.id) {
        anchors.set(scopeId, BigInt(record.position));
      }
    }
    decisions.push(
      await decideNamespace({
        connected,
        control,
        source,
        directory,
        recorded: identities.get(source.namespace.id),
        anchors,
        now,
        log,
      }),
    );
  }
  const bumped = new Set(decisions.flatMap((entry) => entry.decided.map((d) => d.bump.scopeId)));
  const bumps: EpochBump[] = [];

  // (b) and (d) before the bump, (e) and the bump between them and (c).
  const { held } = await replayLedger({
    connected,
    sources,
    directory,
    sinks,
    records,
    bumped,
    clock,
    log,
    beforeKeys: async () => {
      // (e) The effects a restore left requested.
      if (bumped.size > 0) {
        const targets = await anchorScopes(connected, migrated, bumped);
        for (const [scopeId, target] of targets) {
          if (target.scope.level === 'deployment') continue;
          const source = sources.find(
            (candidate) => candidate.namespace.id === target.namespace.id,
          );
          if (source === undefined) continue;
          log.debug('the effects of a restored scope are enqueued again', { scope: scopeId });
          await reenqueueUnsettledEffects({
            connected,
            target,
            registry: source.registry,
            clock,
            directory,
            apps,
          });
        }
      }
      // The bump: the mark's epoch moves first, the counters follow.
      for (const decision of decisions) {
        bumps.push(...(await applyNamespace({ control, decision, now, log })));
      }
      await control.marks.bumped();
    },
  });

  // (f) The hold.
  return { bumps, hold: createRestoreHold(control, clock, held, log), anchors: newest };
}
