import { KeelwerkError } from '@keelwerk/core';

/** The refusal of a second pass of `decide` that asks for more or fewer effect outcomes than the first pass recorded. */
export function replayMismatch(action: string, served: number, recorded: number): KeelwerkError {
  return new KeelwerkError({
    kind: 'internal',
    code: 'core.effect_replay_mismatch',
    message: `${action} asked for ${served} inline effect outcomes where phase one recorded ${recorded}.`,
  });
}
