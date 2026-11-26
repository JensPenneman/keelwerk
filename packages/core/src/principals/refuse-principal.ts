import { KeelwerkError } from '../errors/keelwerk-error.ts';

/** An answer is refused as `internal`; the message names the member's path and never its value. */
export function refusePrincipal(path: string): never {
  throw new KeelwerkError({
    kind: 'internal',
    code: 'core.internal',
    message: `A principal carries "${path}", which is not what its type declares: a principal is plain data.`,
  });
}
