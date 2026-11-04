import { KeelwerkError } from '../errors/keelwerk-error.ts';

/** The `as` of an invoke effect: the action runs as the system principal, logged with the reason (section 7.6). */
export interface SystemReason {
  readonly kind: 'system';
  readonly reason: string;
}

/** `system('revoke the sessions of a deactivated profile')`; an empty reason is refused. */
export function system(reason: string): SystemReason {
  if (reason.trim() === '') {
    throw new KeelwerkError({
      kind: 'validation',
      code: 'core.malformed_request',
      message:
        'system() needs a reason: it is logged with every action run as the system principal.',
    });
  }
  return Object.freeze({ kind: 'system', reason });
}
