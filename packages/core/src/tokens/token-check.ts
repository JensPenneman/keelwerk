import { sha256 } from '../crypto/sha256.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';

/** What a token's `check` part covers (section 15.2.6), as plain values. */
export interface TokenCheckInput {
  /** The read rules in effect for the principal, each with its id and a digest of its conditions and field list. */
  readonly rules: readonly { readonly id: string; readonly digest: string }[];
  readonly principal: {
    readonly id: string | null;
    readonly roles: readonly string[];
    readonly memberships: readonly {
      readonly kind: string;
      readonly id: string;
      readonly role: string;
    }[];
  };
  readonly entity: string;
  /** The partition of the token's selector; the empty string for none. */
  readonly partition: string;
  /**
   * The flags the governing read rules read, each with the variant it had (20.6). Part of the
   * check only when not empty, so a token over rules that read no flag is what M1 issued.
   */
  readonly flags?: readonly { readonly key: string; readonly variant: string }[];
  /** `queryState` only: the filter and sort. */
  readonly selector?: { readonly filter: unknown; readonly sort: unknown };
}

/** The `check` part of a state token: the first 8 hexadecimal characters of SHA-256 over the input in canonical form. */
export function tokenCheck(input: TokenCheckInput): string {
  const sorted = (values: readonly string[]): readonly string[] => [...values].sort();
  return sha256(
    canonicalizeJson({
      rules: [...input.rules].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      principal: {
        id: input.principal.id,
        roles: sorted(input.principal.roles),
        memberships: input.principal.memberships
          .map((m) => `${m.kind}\u0000${m.id}\u0000${m.role}`)
          .sort(),
      },
      entity: input.entity,
      partition: input.partition,
      selector: input.selector ?? null,
      ...(input.flags === undefined || input.flags.length === 0
        ? {}
        : {
            flags: [...input.flags]
              .map(({ key, variant }) => ({ key, variant }))
              .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
          }),
    }),
  ).slice(0, 8);
}
