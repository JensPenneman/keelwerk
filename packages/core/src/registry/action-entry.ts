import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { PageSpec } from '../surface/page-spec.ts';
import type { TransportHints } from '../surface/transport-hints.ts';
import type { ActionHandler } from './action-handler.ts';
import type { GeneratedActionKind } from './generated-action-kind.ts';

/** One action as the registry holds it: the surface fields of section 16.2.2 plus the handlers, without the DSL literal. */
export interface ActionEntry {
  /** 'accounts.profile.deactivate'. */
  readonly ref: string;
  /** The namespace the action is mounted in. */
  readonly module: string;
  readonly entity?: string;
  readonly name: string;
  readonly mount: 'entity' | 'module' | 'app';
  readonly kind: 'query' | 'command' | 'subscription';
  /** Set for the actions the core generated. */
  readonly generated?: GeneratedActionKind;
  /** Entity commands: the input carries `id` and an optional `ifVersion`. */
  readonly instance: boolean;
  readonly input: StandardSchemaV1;
  readonly output: StandardSchemaV1;
  /** Set when the output is `rowOf(entity)` or `pageOf(entity)`: the entity whose rows it carries and whether it is one row or a page. A custom output has none. */
  readonly entityOutput?: { readonly entity: string; readonly shape: 'row' | 'page' };
  /** Declared error codes, sorted. */
  readonly errors: readonly string[];
  readonly auth: 'policy' | 'public';
  readonly scope: 'tenant' | 'backend' | 'deployment' | 'invocation';
  /** Effective, after `defineApp({ execution })`; queries are 'sync'. */
  readonly execution: 'sync' | 'async' | 'either';
  readonly idempotent: boolean;
  /** The boolean flag that must be on for the action to run (section 20.6). */
  readonly gate?: string;
  readonly offline: boolean;
  readonly resumable: boolean;
  /** Narrows `ctx.principal` and refuses other kinds. */
  readonly principal?: readonly PrincipalKind[];
  readonly page?: PageSpec;
  readonly timeoutMs?: number;
  /** How long a receipt of the action answers a retry, in milliseconds; absent: 24 hours (section 7.5). */
  readonly idempotencyWindowMs?: number;
  /** Per-transport hints, keyed by transport id; the surface carries them verbatim. */
  readonly hints: TransportHints;
  /** The module that mounted the action through a contribution or a conditional part. */
  readonly contributedBy?: string;
  readonly description?: string;
  readonly deprecated?: { readonly reason: string; readonly at?: string; readonly sunset?: string };
  /** The API version that introduced the action. */
  readonly since: string;
  /** The API versions whose version changes touched it. */
  readonly changedIn: readonly string[];
  /** Commands with `trace: { input: 'sealed' }`: the decision record keeps the sealed input. */
  readonly trace?: { readonly input: 'sealed'; readonly retention?: string };
  /** Output members shown once: the receipt keeps none of them and a replay answers `conflict`. */
  readonly shownOnce?: readonly string[];
  /** `decide`, `read` or `source`. */
  readonly handler: ActionHandler;
  /** Sync commands only (section 7.9.4, phase 2). */
  readonly prepare?: ActionHandler;
}
