import { KeelwerkError } from '../errors/keelwerk-error.ts';

/**
 * The reference of a mounted part or effect (`auth.credential.revoke`), or a string reference as is.
 * A part that no module literal mounted has none, and an effect payload cannot name it.
 */
export function refOf(part: object | string): string {
  if (typeof part === 'string') return part;
  const ref: unknown = Reflect.get(part, 'ref');
  if (typeof ref === 'string') return ref;
  throw new KeelwerkError({
    kind: 'internal',
    code: 'core.internal',
    message: 'An effect names a part that no module mounts, so it has no reference.',
  });
}
