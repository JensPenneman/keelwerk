import { errors } from '../errors/errors.ts';
import type { AnyDraft } from '../protocol/any-draft.ts';
import { appendEvents } from '../write-path/append-events.ts';
import { draftsToEvents } from '../write-path/drafts-to-events.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import { writeStateRows } from '../write-path/write-state-rows.ts';
import type { EffectRecordTarget } from './effect-record-target.ts';

/**
 * Writes a draft of the `core.effect` entity in the unit, as the kernel: the same steps as any
 * decision (the evolve with its before-image, the state row, the append to the stream
 * `core.effect/<id>`), under the authority of the core and the meta of the decision it joins. A worker settling an effect has no decision: it passes the registry and behaviours of its app as `run`.
 * Answers the id of the event the draft wrote.
 */
export async function writeEffectRecord(
  target: Omit<EffectRecordTarget, 'run'> & {
    readonly run: Pick<RunCommandInput, 'registry' | 'behaviours'>;
  },
  draft: AnyDraft,
): Promise<string> {
  const { run, unit } = target;
  if (!run.registry.entities.has('core.effect')) {
    throw errors.internal('the app has no core.effect entity to record effects in');
  }
  const written = await draftsToEvents({
    unit,
    registry: run.registry,
    behaviours: run.behaviours,
    drafts: [draft],
    authority: 'core',
    now: target.clock.now(),
    meta: () => target.meta,
    reads: [],
    loaded: new Map(),
    hybridClock: target.hybridClock,
  });
  await writeStateRows(unit, written);
  await appendEvents(unit, written);
  const eventId = written[0]?.events.at(-1)?.eventId;
  if (eventId === undefined) throw errors.internal('the effect record wrote no event');
  return eventId;
}
