import type { AnyDraft } from '../protocol/any-draft.ts';

import { definedValues } from './defined-values.ts';

type Values = Readonly<Record<string, unknown>>;

/** A create draft: the stream starts, expected version 0. */
export function createDraftOf(entity: string, id: string, values: Values): AnyDraft {
  return Object.freeze({
    kind: 'create',
    type: 'created',
    target: entity,
    entity,
    id,
    expectedVersion: 0,
    values: definedValues(values),
  }) as AnyDraft;
}
