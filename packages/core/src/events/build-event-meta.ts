import type { Principal } from '../principals/principal.ts';
import type { DecisionRecord } from './decision-record.ts';
import type { EventMeta } from './event-meta.ts';
import type { FlagRead } from './flag-read.ts';

function actorIdOf(principal: Principal): string | null {
  if (principal.kind === 'user') return principal.subject;
  if (principal.kind === 'service') return principal.id;
  return principal.ref?.principalId ?? null;
}

/** What the meta of one event is built from. */
export interface EventMetaInput {
  readonly principal: Principal;
  readonly commandId: string;
  /** 'library.addBook'. */
  readonly action: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly client?: { readonly id: string; readonly seq: number };
  readonly traceparent?: string;
  readonly build: { readonly id: string; readonly revision: number };
  readonly flags: readonly FlagRead[];
  readonly decision: DecisionRecord | null;
}

/**
 * The members of an event envelope that come from its invocation (section 15.1.3): the actor, the
 * command, the correlation, the writer (build and revision), the flags the invocation read and the
 * decision record. `writer`, `flags` and `decision` are part of the chain content (S-60), so they
 * are fixed here: the flags in key order, whatever order the invocation read them in.
 */
export function buildEventMeta(input: EventMetaInput): EventMeta {
  const { principal } = input;
  return {
    actor: { kind: principal.kind, id: actorIdOf(principal), via: principal.via },
    commandId: input.commandId,
    action: input.action,
    causationId: input.causationId ?? null,
    correlationId: input.correlationId,
    client: input.client ?? null,
    merge: null,
    traceparent: input.traceparent ?? null,
    writer: { build: input.build.id, revision: input.build.revision },
    flags: [...input.flags]
      .map((flag) => ({
        key: flag.key,
        variant: flag.variant,
        reason: flag.reason,
        ruleVersion: flag.ruleVersion,
      }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    decision: input.decision,
  };
}
