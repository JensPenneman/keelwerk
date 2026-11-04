import type { TypedFlagParameter } from '@stricli/core';
import type { CliContext } from '../context/cli-context.ts';

/** A flag as Stricli takes it (section 16.9.10). */
export type FlagParameter = TypedFlagParameter<unknown, CliContext>;
