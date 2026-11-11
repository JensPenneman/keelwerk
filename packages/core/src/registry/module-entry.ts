import type { FlagPurpose } from '../dsl/define-flag.ts';

/** One selected module, in the topological order `compose` fixed. */
export interface ModuleEntry {
  readonly id: string;
  /** Lower camel case, as it appears in the context (`mail-store` is `mailStore`). */
  readonly contextName: string;
  readonly version: string;
  /** Position in the topological order. */
  readonly order: number;
  readonly description?: string;
  /** 'all': the module's reactions may say `on: 'all'` (G12). */
  readonly observes?: 'all';
  readonly configAccess?: { readonly level: 'tenant'; readonly edit: 'policy' };
  /** The boolean flag that gates the module's actions (section 20.6). */
  readonly gate?: string;
  readonly requires: readonly string[];
  readonly optional: readonly string[];
  /** Contracts the module provides and requires (section 5.4). */
  readonly provides: readonly string[];
  readonly needs: readonly string[];
  /** References of what the module owns or mounts; the entries are in the registry's maps. */
  readonly entities: readonly string[];
  readonly actions: readonly string[];
  readonly rules: readonly string[];
  readonly reactions: readonly string[];
  readonly hooks: readonly string[];
  readonly services: readonly string[];
  readonly extensionPoints: readonly string[];
  /** Flags the module declares (section 20.2); a flag request answers the declared default with reason 'DEFAULT' (20.3, decision 185). */
  readonly flags: Readonly<
    Record<
      string,
      {
        readonly kind: 'boolean' | 'string' | 'number' | 'json' | 'variant';
        readonly level: 'deployment' | 'backend' | 'tenant' | 'principal';
        readonly default: unknown;
        readonly variants?: readonly string[];
        readonly description?: string;
        readonly purpose?: FlagPurpose;
        /** ISO date. */
        readonly expires?: string;
        /** Readable through `core.flag.evaluate`. */
        readonly client?: boolean;
      }
    >
  >;
}
