import type { ActorRef } from '../principals/actor-ref.ts';
import type { DecisionRecord } from './decision-record.ts';
import type { FlagRead } from './flag-read.ts';
import type { MergeReport } from './merge-report.ts';

/** The envelope members a new event takes from its invocation; `writer`, `flags` and `decision` are in the chain content (S-60). */
export interface EventMeta {
  readonly actor: ActorRef;
  readonly commandId: string | null;
  readonly action: string | null;
  readonly causationId: string | null;
  readonly correlationId: string;
  readonly client: { readonly id: string; readonly seq: number } | null;
  readonly merge: MergeReport | null;
  readonly traceparent: string | null;
  readonly writer: { readonly build: string; readonly revision: number };
  readonly flags: readonly FlagRead[];
  readonly decision: DecisionRecord | null;
}
