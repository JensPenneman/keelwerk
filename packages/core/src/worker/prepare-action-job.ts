import { secretMembersAsRefs } from '../effects/secret-members-as-refs.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import { openSecretMembers } from '../write-path/open-secret-members.ts';
import type { QueueSource } from './queue-source.ts';
import { receiptOfJob } from './receipt-of-job.ts';

/**
 * The continuation's input with the secret members of a successful `outcome.value` presented as
 * references of the effect's module (G4): a continuation reads an output secret as a stamped
 * reference, never as the text a plain string would be. Any other input passes unchanged.
 */
function withOutcomeReferences(
  source: QueueSource,
  outcomeEffect: string | undefined,
  input: unknown,
): unknown {
  const effect =
    outcomeEffect === undefined ? undefined : source.registry.effects.get(outcomeEffect);
  if (effect === undefined || typeof input !== 'object' || input === null) return input;
  const outcome: unknown = Reflect.get(input, 'outcome');
  if (typeof outcome !== 'object' || outcome === null || Reflect.get(outcome, 'ok') !== true) {
    return input;
  }
  const value: unknown = Reflect.get(outcome, 'value');
  if (typeof value !== 'object' || value === null) return input;
  return {
    ...input,
    outcome: {
      ...outcome,
      value: secretMembersAsRefs(
        effect.output,
        effect.module,
        value as Readonly<Record<string, unknown>>,
      ),
    },
  };
}

/** What an action job runs with, read before it is invoked. */
export interface PreparedJob {
  /** The input as the command takes it: the secret members opened. */
  readonly input: unknown;
  /**
   * The transport the gate judges the job under: the one its accepted receipt records, so the check
   * at execution is the one made at acceptance; null for a job with no receipt of its own (an
   * `enqueue` effect), where every transport-scoped deny rule applies and an allow rule limited to
   * a transport does not.
   */
  readonly transport: string | null;
}

/**
 * Reads a job's receipt and opens the secret members of its input in one read-only unit of its
 * scope (S-127, S-122). A continuation's output secrets become references of the effect's module. A job with no command id has neither. A key that is gone is `conflict`,
 * which fails the job.
 */
export async function prepareActionJob(
  source: QueueSource,
  stored: StoredJob,
  run: { readonly action: string; readonly input: unknown; readonly commandId?: string },
): Promise<PreparedJob> {
  const { action, input, commandId } = run;
  if (commandId === undefined) return { input, transport: null };
  const entry = source.registry.actions.get(action);
  return source.handle.adapter.unit(
    source.namespace,
    stored.scope,
    async (unit) => {
      const receipt = await receiptOfJob(unit, stored, action, commandId);
      return {
        input:
          entry === undefined
            ? input
            : withOutcomeReferences(
                source,
                entry.outcomeEffect,
                await openSecretMembers(
                  unit,
                  {
                    entity: 'core.job',
                    id: commandId,
                    prefix: '',
                    lost: 'The stored input of this job can no longer be read.',
                  },
                  entry.input,
                  input,
                ),
              ),
        transport: receipt?.request.transport ?? null,
      };
    },
    { readOnly: true },
  );
}
