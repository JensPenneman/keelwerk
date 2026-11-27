import type { AnyField } from '../fields/field-def.ts';
import type { Registry } from '../registry/registry.ts';
import type { PurgedJob } from '../storage/purged-job.ts';
import type { Unit } from '../storage/unit.ts';
import { sealedMemberKeys } from './sealed-member-keys.ts';

/**
 * The ids of the value keys that the secret members of purged command jobs were sealed under
 * (`sealJobInput`: entity `core.job`, the job's command id, the member name; `sealedMemberKeys`).
 * A job whose action the registry no longer holds, or that has no command id, names no key.
 */
export async function jobValueKeys(
  unit: Unit,
  registry: Registry,
  jobs: readonly PurgedJob[],
): Promise<readonly string[]> {
  const keyIds = new Set<string>();
  for (const { run } of jobs) {
    if (!('action' in run) || run.commandId === undefined) continue;
    const { fields } = (registry.actions.get(run.action)?.input ?? {}) as {
      readonly fields?: Readonly<Record<string, AnyField>>;
    };
    const keys = await sealedMemberKeys(unit, fields, run.input, {
      entity: 'core.job',
      id: run.commandId,
      prefix: '',
    });
    for (const keyId of keys) keyIds.add(keyId);
  }
  return [...keyIds];
}
