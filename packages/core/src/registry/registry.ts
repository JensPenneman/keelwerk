import type { ActionEntry } from './action-entry.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { ContributionEntry } from './contribution-entry.ts';
import type { EffectEntry } from './effect-entry.ts';
import type { EntityEntry } from './entity-entry.ts';
import type { ExecutorEntry } from './executor-entry.ts';
import type { ExtensionFillEntry } from './extension-fill-entry.ts';
import type { ExtensionPointEntry } from './extension-point-entry.ts';
import type { HookEntry } from './hook-entry.ts';
import type { ModuleEntry } from './module-entry.ts';
import type { QuotaEntry } from './quota-entry.ts';
import type { ReactionEntry } from './reaction-entry.ts';
import type { RuleEntry } from './rule-entry.ts';
import type { ScheduleEntry } from './schedule-entry.ts';
import type { ServiceEntry } from './service-entry.ts';
import type { StreamEntry } from './stream-entry.ts';
import type { TopicEntry } from './topic-entry.ts';
import type { VersionChangeEntry } from './version-change-entry.ts';

/**
 * What `compose` produces for one app and every kernel subsystem reads. Maps are keyed by
 * reference or id and iterate in sorted order; `modules` is in topological order.
 */
export interface Registry {
  /** The app id. */
  readonly app: string;
  readonly modules: readonly ModuleEntry[];
  readonly entities: ReadonlyMap<string, EntityEntry>;
  readonly actions: ReadonlyMap<string, ActionEntry>;
  readonly rules: ReadonlyMap<string, RuleEntry>;
  readonly reactions: ReadonlyMap<string, ReactionEntry>;
  readonly hooks: ReadonlyMap<string, HookEntry>;
  readonly services: ReadonlyMap<string, ServiceEntry>;
  /** External effects by reference, 'hooks.post'. */
  readonly effects: ReadonlyMap<string, EffectEntry>;
  /** Executors by the reference of their effect. */
  readonly executors: ReadonlyMap<string, ExecutorEntry>;
  /** Schedules by reference, 'dns.refreshPublicAddressSchedule'. */
  readonly schedules: ReadonlyMap<string, ScheduleEntry>;
  /** Streams by reference (section 15.1.12). */
  readonly streams: ReadonlyMap<string, StreamEntry>;
  /** Topics by reference (G6). */
  readonly topics: ReadonlyMap<string, TopicEntry>;
  /** Version changes by id (section 18.2). */
  readonly versionChanges: ReadonlyMap<string, VersionChangeEntry>;
  /** Declared quota dimensions by reference (section 12.2). */
  readonly quotas: ReadonlyMap<string, QuotaEntry>;
  readonly extensionPoints: ReadonlyMap<string, ExtensionPointEntry>;
  /** Per point reference, in fill order. */
  readonly fills: ReadonlyMap<string, readonly ExtensionFillEntry[]>;
  readonly contributions: readonly ContributionEntry[];
  /** Empty for an app `defineApp` accepts. */
  readonly problems: readonly CompositionProblem[];
}
