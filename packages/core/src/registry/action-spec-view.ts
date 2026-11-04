import type { AnyErrorDefinition } from '../errors/error-definition.ts';
import type { AnyActionPart } from '../model/action-part.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { ActionHandler } from './action-handler.ts';

/** The members of an action literal that `compose` reads. */
export interface ActionSpecView {
  readonly input?: { readonly kind?: string; readonly fields?: object } | undefined;
  readonly output?: {
    readonly kind?: string;
    readonly form?: string;
    readonly entity?: { readonly prefix: string };
  };
  readonly errors?: readonly AnyErrorDefinition[];
  readonly auth?: 'policy' | { readonly public: true };
  readonly principal?: PrincipalKind | readonly PrincipalKind[];
  readonly scope?: 'tenant' | 'backend' | 'deployment';
  readonly idempotent?: boolean;
  readonly timeoutMs?: number;
  readonly hints?: { readonly [transport: string]: unknown };
  readonly description?: string;
  readonly deprecated?: { readonly reason: string; readonly at?: string; readonly sunset?: string };
  readonly offline?: boolean;
  readonly page?: {
    readonly sortable?: readonly string[];
    readonly defaultSize?: number;
    readonly maxSize?: number;
  };
  readonly prepare?: ActionHandler;
  readonly decide?: ActionHandler;
  readonly read?: ActionHandler;
  readonly source?: ActionHandler;
}

/** An action part's literal. */
export function specOf(part: AnyActionPart): ActionSpecView {
  return part.spec as ActionSpecView;
}
