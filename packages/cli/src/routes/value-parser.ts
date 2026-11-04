import type { CliContext } from '../context/cli-context.ts';

/** A flag or positional parser: text in, the wire value out. */
export type ValueParser = (this: CliContext, input: string) => unknown;
