import { errors } from '../errors/errors.ts';
import type { AnyDraft } from '../protocol/any-draft.ts';
import type { AnyEffect } from '../protocol/any-effect.ts';
import type { StreamAppendDraft } from '../protocol/stream-append-draft.ts';

function isDraft(value: unknown): value is AnyDraft {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'entity' in value &&
    'values' in value
  );
}

function isAppend(value: unknown): value is StreamAppendDraft {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'append' &&
    'stream' in value &&
    'key' in value &&
    'records' in value
  );
}

/** What `decide` returned, in one shape. */
export interface NormalizedDecision {
  readonly drafts: readonly AnyDraft[];
  /** The stream append drafts, in order; they are applied after the entity drafts (G6). */
  readonly appends: readonly StreamAppendDraft[];
  readonly effects: readonly AnyEffect[];
  readonly result: unknown;
}

/**
 * Reads a `Decision` (section 7.9.2): a list of drafts, or `{ events, effects, result }`, or
 * nothing. Anything else in the list is a handler bug and fails the command as `internal`.
 */
export function normalizeDecision(value: unknown): NormalizedDecision {
  if (value === undefined || value === null)
    return { drafts: [], appends: [], effects: [], result: undefined };
  const body = Array.isArray(value)
    ? { events: value as readonly unknown[] }
    : (value as { events?: readonly unknown[]; effects?: readonly AnyEffect[]; result?: unknown });
  const events = body.events ?? [];
  for (const draft of events) {
    if (!isDraft(draft) && !isAppend(draft)) {
      throw errors.internal('decide returned something that is not a draft among its events');
    }
  }
  return {
    drafts: events.filter(isDraft),
    appends: events.filter(isAppend),
    effects: 'effects' in body ? (body.effects ?? []) : [],
    result: 'result' in body ? body.result : undefined,
  };
}
