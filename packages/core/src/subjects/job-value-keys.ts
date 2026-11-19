import type { AnyField } from '../fields/field-def.ts';
import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';
import { sealedTextsOf } from '../keys/sealed-texts-of.ts';
import type { Registry } from '../registry/registry.ts';
import type { PurgedJob } from '../storage/purged-job.ts';
import type { Unit } from '../storage/unit.ts';

/**
 * The ids of the value keys that the secret members of purged command jobs were sealed under
 * (`sealJobInput`: entity `core.job`, the job's command id, the member name). A text counts only
 * when it opens against that binding, so a member that holds another document's text, or a key
 * that was destroyed before, names nothing. A `{ ref }` member names a key of the document it
 * was loaded from and is never touched. A job whose action the registry no longer holds, or that
 * has no command id, names no key.
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
    if (fields === undefined || typeof run.input !== 'object' || run.input === null) continue;
    const stored = run.input as Readonly<Record<string, unknown>>;
    for (const [name, field] of Object.entries(fields)) {
      if (!Object.hasOwn(stored, name)) continue;
      for (const text of sealedTextsOf(field, stored[name])) {
        const sealed = parseSealedValueText(text);
        if (sealed === undefined) continue;
        const opened = await unit.keys.openValue(sealed, {
          entity: 'core.job',
          id: run.commandId,
          field: name,
        });
        if (opened !== undefined) keyIds.add(sealed.keyId);
      }
    }
  }
  return [...keyIds];
}
