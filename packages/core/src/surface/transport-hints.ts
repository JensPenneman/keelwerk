import type { CliHint } from './cli-hint.ts';
import type { CookieHint } from './cookie-hint.ts';
import type { ResponseHint } from './response-hint.ts';

/**
 * Per-transport hints of an action: they rename, hide or choose how an output is carried, and never
 * change behaviour, authorization or validation (section 16.2.2).
 */
export interface TransportHints {
  readonly rest?: {
    readonly path?: string;
    readonly collection?: string;
    readonly expose?: boolean;
  };
  readonly graphql?: {
    readonly field?: string;
    readonly type?: string;
    readonly expose?: boolean;
    /**
     * The GraphQL enum type of a top-level enum member of the output (a subscription's event), by
     * member name: `{ status: 'CoreEffectStatus' }`. Fields of one enum type name and the same values
     * share the type; other values under the name are a `nameCollision`.
     */
    readonly enums?: Readonly<Record<string, string>>;
  };
  readonly trpc?: { readonly path?: string; readonly expose?: boolean };
  readonly cli?: CliHint;
  /** Every HTTP transport. */
  readonly http?: { readonly cookie?: CookieHint; readonly response?: ResponseHint };
  /** Later transports. */
  readonly [transport: string]: unknown;
}
