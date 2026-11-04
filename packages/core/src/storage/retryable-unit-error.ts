/**
 * What an adapter throws when a unit lost a serialization failure or a deadlock (S-54). The kernel
 * repeats the command up to three times; the error is kernel-internal and never reaches the wire.
 * Version conflicts stay `conflict` with `core.version_mismatch`.
 */
export class RetryableUnitError extends Error {
  override readonly name: string = 'RetryableUnitError';
  readonly reason: 'serialization_failure' | 'deadlock';

  constructor(
    reason: 'serialization_failure' | 'deadlock',
    options?: { readonly cause?: unknown },
  ) {
    super(`unit failed with ${reason}`, options);
    this.reason = reason;
  }
}
