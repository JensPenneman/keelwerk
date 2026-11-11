import type { FlagRead } from '../events/flag-read.ts';
import type { RecordedAnswer } from '../events/recorded-answer.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import type { FlagSnapshot } from '../flags/flag-snapshot.ts';
import type { Logger } from '../observability/logger.ts';
import type { Principal } from '../principals/principal.ts';
import type { AnyRequest } from '../protocol/any-request.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { Unit } from '../storage/unit.ts';
import type { Clock } from './clock.ts';
import type { ComputePool } from './compute-pool.ts';
import type { KeyService } from './key-service.ts';

/** What an answerer needs to answer one request of one invocation (section 7.9.3). */
export interface AnswerContext {
  readonly registry: Registry;
  /** The unit loads run in. */
  readonly unit: Unit;
  readonly scope: Scope;
  readonly principal: Principal;
  /** The module whose part yielded the request: its authority and configuration apply. */
  readonly module: string;
  /** The handler form; a query refuses ids, random values, issued secrets and effects (`core.request_not_allowed`, S-06). */
  readonly form: 'decide' | 'prepare' | 'read' | 'react' | 'source';
  readonly clock: Clock;
  readonly keys: KeyService;
  readonly compute: ComputePool;
  readonly log: Logger;
  /** The flag answers the invocation has given so far; they become `meta.flags` (S-23). */
  readonly flags: ReadonlyMap<string, FlagRead>;
  /** The invocation's flag snapshot (20.3); absent: every flag answers its declared default (M1). */
  readonly flagSnapshot?: FlagSnapshot | undefined;
  /** Answers a nested request (`all`, `maybe`) in the same context. */
  answer(request: AnyRequest): Promise<unknown>;
  /** Appends to the decision record being built. */
  readonly record: {
    read(read: RecordedRead): void;
    answer(answer: RecordedAnswer): void;
    flag(read: FlagRead): void;
  };
}
