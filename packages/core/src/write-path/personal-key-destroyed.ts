import { coreErrorCodes } from '../errors/core-error-codes.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';

/**
 * A personal member of a stored input cannot be opened because the data key of its subject is
 * destroyed (the subject was erased). The job that holds the input ends and never runs again: the
 * worker settles it by its queue (`endJobAfterErasure`). The code of PersonalKeyDestroyed is the
 * closed `core.key_destroyed`, so what a receipt, a history row or an effect keeps is the code
 * alone. By contrast, the `conflict` that opening throws for a gone value key of a secret member,
 * or for an envelope sealed for another job, is not retryable: the job gives up at once (`failed`,
 * or `dead` with a dead letter).
 */
export class PersonalKeyDestroyed extends KeelwerkError {
  override readonly name: string = 'PersonalKeyDestroyed';

  constructor(message: string) {
    super({ kind: coreErrorCodes['core.key_destroyed'].kind, code: 'core.key_destroyed', message });
  }
}
