import { generatedEntity } from '../generated-actions/generated-entity.ts';
import { generatedHandlerOf } from '../generated-actions/generated-handler-of.ts';
import { generatedSet } from '../generated-actions/generated-set.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import { decodeRow } from '../repositories/decode-row.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import type { OpenedDecision } from './open-decision.ts';
import type { RunCommandInput } from './run-command-input.ts';

export interface HandleDecisionInput {
  readonly run: RunCommandInput;
  readonly unit: Unit;
  readonly decision: OpenedDecision;
  /** Entity commands: the target and its row as loaded. */
  readonly target?: { readonly entry: EntityEntry; readonly row: StorageRow };
}

/**
 * What `decide` returned before it is driven: `generatedSet` for a generated set, the generated
 * handler of create, update, archive and restore, else `action.handler`; an entity command gets
 * the input without id and ifVersion, its decoded row and the context. Writing and replaying a
 * decision both run it, so a re-decide takes the same path as the command did.
 */
export async function handleDecision(input: HandleDecisionInput): Promise<unknown> {
  const { run, unit, decision, target } = input;
  const { action, registry } = run;
  const authority = action.contributedBy ?? action.module;
  const generated = action.generated === undefined ? undefined : generatedEntity(registry, action);
  if (action.generated === 'set' && generated !== undefined) {
    return generatedSet({ run, unit, entry: generated, decision });
  }
  const handler = generated === undefined ? action.handler : generatedHandlerOf(action, generated);
  if (target === undefined) return handler(run.input, decision.ctx);
  const { id: _id, ifVersion: _ifVersion, ...rest } = run.input as Record<string, unknown>;
  return handler(rest, decodeRow(target.entry, target.row, authority), decision.ctx);
}
