import type { ActorRef } from '../principals/actor-ref.ts';
import type { Position } from '../storage/position.ts';
import type { DecisionRecord } from './decision-record.ts';
import type { FlagRead } from './flag-read.ts';
import type { Hlc } from './hlc.ts';
import type { MergeReport } from './merge-report.ts';
import type { StreamRef } from './stream-ref.ts';

/** The stored form of an event (section 15.1.3). Every member is written from M1, so the format is final. */
export interface EventEnvelope<Type extends string = string, Data = unknown> {
  /** UUIDv7. */
  readonly eventId: string;
  /** Within the scope. */
  readonly position: Position;
  /** `NamespaceRef.id`. */
  readonly namespace: string;
  readonly scope: { readonly backendId: string; readonly tenantId: string | null };
  readonly stream: StreamRef;
  /** 1-based within the stream. */
  readonly version: number;
  readonly partition: string | null;
  /** Full name: 'accounts.profile.deactivated'. */
  readonly type: Type;
  /** The shape id it was written with; reads through the kernel are upcast (section 15.1.9). */
  readonly shape: string;
  readonly data: Data;
  readonly before: Readonly<Record<string, unknown>> | null;
  /** Authoring time: the server's, or the client's for offline mutations. */
  readonly hlc: Hlc;
  /** Acceptance time on the server. */
  readonly recordedAt: Temporal.Instant;
  readonly actor: ActorRef;
  /** Null for kernel work: retention, erasure, imports. */
  readonly commandId: string | null;
  /** 'accounts.profile.deactivate'. */
  readonly action: string | null;
  /** The event or command that caused this one. */
  readonly causationId: string | null;
  readonly correlationId: string;
  /** Offline-authored mutations (M6). */
  readonly client: { readonly id: string; readonly seq: number } | null;
  /** What lost an lww comparison (M6). */
  readonly merge: MergeReport | null;
  /** The build and revision that appended it (section 19.1). */
  readonly writer: { readonly build: string; readonly revision: number };
  /** The flags the invocation read (section 20.5). */
  readonly flags: readonly FlagRead[];
  /** The decision that produced the event (section 7.9.6); null for kernel work. */
  readonly decision: DecisionRecord | null;
  readonly transient: boolean;
  /** Hexadecimal SHA-256. */
  readonly prevHash: string | null;
  readonly hash: string | null;
  readonly traceparent: string | null;
}
