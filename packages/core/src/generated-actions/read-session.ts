import type { RelationAnswerer } from '../authorization/relation-answerer.ts';
import { chainColumns } from '../events/chain-columns.ts';
import { principalContextOf } from '../interpreter/principal-context-of.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import { type CallerView, callerView } from '../repositories/caller-view.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { GeneratedReadInput } from './generated-read-input.ts';

const systemFields: readonly string[] = [
  'id',
  'version',
  'createdAt',
  'updatedAt',
  'archivedAt',
  '$masked',
];

/** The caller's view of the entity for a generated read, and the helpers that shape its rows. */
export interface ReadSession {
  readonly view: CallerView;
  readonly answerer: RelationAnswerer;
  /** Masks the rows by the caller's plan and takes out what no client sees: chain columns, hidden, sealed and verifier fields. */
  present(rows: readonly StorageRow[]): Promise<readonly StorageRow[]>;
}

/** The session of a generated read: the plan of the invoked action for this principal. */
export function readSession(input: GeneratedReadInput): ReadSession {
  const { entry, unit, registry } = input;
  const view = callerView({
    entry,
    rules: input.rules,
    action: input.action,
    context: principalContextOf(registry, input.principal, input.scope),
  });
  const answerer: RelationAnswerer = async (ref, node, ids) => {
    const related = registry.entities.get(ref);
    if (related === undefined) throw refuseRequest(ref, 'it is not an entity of this app');
    return unit.rows.matching(related.descriptor, ids, node);
  };
  return {
    view,
    answerer,
    async present(rows) {
      const masked = await view.mask(rows, answerer);
      return masked.map((row) => {
        const shown: Record<string, unknown> = {};
        for (const [name, value] of Object.entries(row)) {
          if (chainColumns.includes(name)) continue;
          const field = entry.descriptor.fields[name];
          if (field !== undefined) {
            if (field.hidden !== false || field.sealed || field.kind === 'verifier') continue;
            if (field.kind === 'secret') continue;
          } else if (!systemFields.includes(name)) {
            continue;
          }
          shown[name] = value;
        }
        return shown;
      });
    },
  };
}
