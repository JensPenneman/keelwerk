import { KeelwerkError } from '../errors/keelwerk-error.ts';

/**
 * The error of a request a part may not make once its types are bypassed, and of a request this
 * release does not answer (S-06): `internal`, `core.request_not_allowed`, whose details name the
 * request and the reason. `subject` is what was asked, such as `load.byId` or `a promise`.
 */
export function refuseRequest(subject: string, reason: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'internal',
    code: 'core.request_not_allowed',
    message: `${subject} is not allowed here: ${reason}`,
    details: { request: subject, reason },
  });
}
