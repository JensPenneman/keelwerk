import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { ActionHandler } from './action-handler.ts';

/** The handler of a generated action: the kernel executes these, so no handler code runs. */
export const generatedHandler: ActionHandler = () => {
  throw new KeelwerkError({
    kind: 'internal',
    code: 'core.internal',
    message: 'A generated action is executed by the kernel, not by a handler.',
  });
};
