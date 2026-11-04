import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { ActionHandler } from './action-handler.ts';
import type { EntityEntry } from './entity-entry.ts';
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
  /** Declared error codes, sorted. */
  readonly errors: readonly string[];
  readonly auth: 'policy' | 'public';
  readonly scope: 'tenant' | 'backend' | 'deployment';
  /** Effective, after `defineApp({ execution })`; queries are 'sync'. */
  readonly execution: 'sync' | 'async' | 'either';
  readonly idempotent: boolean;
  readonly offline: boolean;
  readonly resumable: boolean;
  /** Narrows `ctx.principal` and refuses other kinds. */
  readonly principal?: readonly PrincipalKind[];
  readonly page?: EntityEntry['page'];
  readonly timeoutMs?: number;
  /** Per-transport hints, keyed by transport id; the surface carries them verbatim. */
  readonly hints: Readonly<Record<string, unknown>>;
  /** The module that mounted the action through a contribution or a conditional part. */
  readonly contributedBy?: string;
  readonly description?: string;
  readonly deprecated?: { readonly reason: string; readonly at?: string; readonly sunset?: string };
  /** The API version that introduced the action. */
  readonly since: string;
  /** The API versions whose version changes touched it. */
  readonly changedIn: readonly string[];
  /** `decide`, `read` or `source`. */
  readonly handler: ActionHandler;
  /** Sync commands only (section 7.9.4, phase 2). */
  readonly prepare?: ActionHandler;
}
