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
 * The members of an event envelope that come from its invocation (section 15.1.3). This is the
 * minimal form the write path starts with: the actor, the command, the correlation and the
 * writer. The decision records and the chain content arrive with the decision-record work
 * package, which replaces this file and keeps its signature.
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
    flags: input.flags,
    decision: input.decision,
  };
}
