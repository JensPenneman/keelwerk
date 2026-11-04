import { portabilityCodes } from './portability-codes.ts';

/** The lines of a compiler output that carry one of the portability codes. */
export function checkEmitErrors(output: string): readonly string[] {
  return output
    .split('\n')
    .filter((line) => portabilityCodes.some((code) => line.includes(`error ${code}:`)));
}
