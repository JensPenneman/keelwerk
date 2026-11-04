import type { FieldNode } from './field-node.ts';
import type { PageSpec } from './page-spec.ts';
import type { TransportHints } from './transport-hints.ts';

export interface SurfaceAction {
  /** 'accounts.profile.deactivate'. */
  readonly ref: string;
  /** The namespace the action is mounted in. */
  readonly module: string;
  readonly entity?: string;
  readonly name: string;
  readonly mount: 'entity' | 'module' | 'app';
  readonly kind: 'query' | 'command' | 'subscription';
  /** 'get' | 'query' | 'changes' | 'queryChanges' | 'create' | 'update' | 'archive' | 'restore' | 'set' | 'watch' | 'history'. */
  readonly generated?: string;
  /** Entity commands: the input carries `id` and an optional `ifVersion`. */
  readonly instance: boolean;
  /** Kind 'shape', 'foreign' or 'void'. */
  readonly input: FieldNode;
  /** For subscriptions: one emitted item. */
  readonly output: FieldNode;
  /** Declared error codes, sorted. */
  readonly errors: readonly string[];
  readonly auth: 'policy' | 'public';
  readonly scope: 'tenant' | 'backend' | 'deployment';
  /** Effective, after `defineApp({ execution })`; queries are 'sync'. */
  readonly execution: 'sync' | 'async' | 'either';
  readonly idempotent: boolean;
  readonly offline: boolean;
  readonly resumable: boolean;
  readonly page?: PageSpec;
  readonly timeoutMs?: number;
  readonly hints: TransportHints;
  /** Module id when mounted by a contribution or a conditional part. */
  readonly contributedBy?: string;
  readonly description?: string;
  readonly deprecated?: {
    readonly reason: string;
    readonly at?: string;
    readonly sunset?: string;
  };
  /** The API version that introduced the action. */
  readonly since: string;
  /** The API versions whose version changes touched it. */
  readonly changedIn: readonly string[];
  /** SHA-256 of the input's field node, so a diff names what changed. */
  readonly inputHash: string;
  readonly outputHash: string;
}
