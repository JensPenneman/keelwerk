import { KeelwerkError } from '../../errors/keelwerk-error.ts';

/** The answer for a reference the app does not serve, which an internal command gives to every caller but a worker's job. */
export function unknownAction(ref: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'not_implemented',
    code: 'core.not_implemented',
    message: `"${ref}" is not an action of this app.`,
  });
}
