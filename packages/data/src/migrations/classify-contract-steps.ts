import type { MigrationStep } from '@keelwerk/core';
import { isContractStep } from './is-contract-step.ts';

/** The steps of a file split into those every build can run against (expand) and the contract steps, each in order. */
export function classifyContractSteps(steps: readonly MigrationStep[]): {
  readonly expand: readonly MigrationStep[];
  readonly contract: readonly MigrationStep[];
} {
  return {
    expand: steps.filter((step) => !isContractStep(step)),
    contract: steps.filter(isContractStep),
  };
}
