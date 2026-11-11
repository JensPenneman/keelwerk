import { errors } from '../errors/errors.ts';
import type { JobCarrier } from '../invoker/job-carrier.ts';
import type { OpenedAsyncReaction } from '../reactions/open-async-reaction.ts';
import { openAsyncReaction } from '../reactions/open-async-reaction.ts';
import type { ReactionJobInput } from '../reactions/reaction-job-input.ts';
import type { Unit } from '../storage/unit.ts';
import type { RunCommandInput } from './run-command-input.ts';

/**
 * What a job that runs a reaction decides with (7.7): the event the job names, read in the job's
 * unit, and for a process its state folded from the instance's stream. Undefined for any other job.
 * `internal` when the job's action is no reaction of the app.
 */
export async function openReactionJob(
  unit: Unit,
  run: RunCommandInput,
  job: JobCarrier | undefined,
): Promise<OpenedAsyncReaction | undefined> {
  if (job?.reaction !== true) return undefined;
  const reaction = run.registry.reactions.get(run.action.ref);
  if (reaction === undefined)
    throw errors.internal(`"${run.action.ref}" is no reaction of this app`);
  return openAsyncReaction({
    unit,
    registry: run.registry,
    reaction,
    input: run.input as ReactionJobInput,
    log: run.log,
  });
}
