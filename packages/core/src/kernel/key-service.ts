import type { SecretRef } from '../ids/secret-ref.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import type { Unit } from '../storage/unit.ts';
import type { IssuedSecret } from './issued-secret.ts';
import type { VerifyOutcome } from './verify-outcome.ts';

/**
 * The key service of section 14.7.4: one component in the core. It issues and verifies tokens,
 * reveals secrets by reference and derives scope-bound keys. Subject data keys and value keys stay
 * on `Unit.keys`, which the service wraps and unwraps through the scope key hierarchy.
 */
export interface KeyService {
  /** `ctx.secrets.issue({ prefix, bytes? })`; the verifier is HMAC-SHA-256 under HKDF of the scope's key (S-32). */
  issue(
    scope: StorageScope,
    options: { readonly prefix: string; readonly bytes?: number },
  ): Promise<IssuedSecret>;
  /** `ctx.secrets.verify(token, verifier)` under the scope's key, in constant time. */
  verify(scope: StorageScope, token: string, verifier: string): Promise<boolean>;
  /** Kernel only: 'destroyed' when the scope key a verifier was made under is gone, never thrown. */
  verifyOutcome(scope: StorageScope, token: string, verifier: string): Promise<VerifyOutcome>;
  /**
   * `ctx.secrets.reveal(ref, reason)`; the value key comes from `unit.keys.openValue`, `reason` is
   * logged. With `expected`, a sealed value opens only for the binding (entity, row id and member)
   * it was sealed for, so a text copied to another row, effect or member is `not_found`.
   */
  reveal(
    unit: Unit,
    ref: SecretRef,
    reason: string,
    expected?: { readonly entity: string; readonly id: string; readonly field: string },
  ): Promise<string>;
  /**
   * HKDF-SHA-256 from the scope's current key (index keys, bucket keys: S-36); `info` names the
   * purpose and version. A scope without a key gets one, unless `create` is `false` (a reader that
   * must not write): then the scope is `not_found` and nothing is created.
   */
  derive(
    scope: StorageScope,
    info: string,
    length: number,
    options?: { readonly create?: false },
  ): Promise<Uint8Array>;
  /** Drops cached keys of the scope, after an erasure or a retirement. */
  invalidate(scope: StorageScope): void;
}
