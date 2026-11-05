import type { AnyDraft } from '../protocol/any-draft.ts';

import { definedValues } from './defined-values.ts';

type Values = Readonly<Record<string, unknown>>;

/** The draft of an instance operation on a loaded row: it carries the row's version (S-21). */
export function instanceDraftOf(
  kind: 'update' | 'archive' | 'restore',
  entity: string,
  row: Values,
  values: Values,
): AnyDraft {
  return Object.freeze({
    kind,
    type: kind === 'update' ? 'changed' : kind === 'archive' ? 'archived' : 'restored',
    target: entity,
    entity,
    id: String(row.id),
    expectedVersion: Number(row.version),
    values: definedValues(values),
  }) as AnyDraft;
}
