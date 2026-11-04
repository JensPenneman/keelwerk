import type { SecretRef } from '../ids/secret-ref.ts';
import type { IssuedSecret } from '../kernel/issued-secret.ts';
import type { SecretRequest } from '../protocol/secret-request.ts';

/** Secret requests (section 7.9.3). */
export interface SecretRequests {
  issue(options: { readonly prefix: string }): SecretRequest<IssuedSecret>;
  reveal(ref: SecretRef, reason: string): SecretRequest<string>;
  verify(token: string, verifier: string): SecretRequest<boolean>;
}
