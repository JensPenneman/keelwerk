/**
 * The parts of a state token (section 15.2.6). `version` is the token's format; `check` is the
 * sealed check: an HMAC, under the scope's token key, of the selector's check, the epoch, the position
 * and the scope, so a holder of the token cannot change a part and make the check fit the rest.
 */
export interface StateTokenParts {
  readonly version: 1 | 2;
  readonly epoch: number;
  readonly position: bigint;
  readonly scope: string;
  readonly check: string;
}

/** What a token is made from: the `check` is the one of the token's selector (`currentTokenCheck`), which the encoder seals. */
export interface StateTokenSource {
  readonly epoch: number;
  readonly position: bigint;
  readonly scope: string;
  readonly check: string;
}
