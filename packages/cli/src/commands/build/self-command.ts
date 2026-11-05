import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { ChildCommandLine } from './child-command-line.ts';

/** The command that runs this binary again with `args`, under the same Node options. */
export function selfCommand(args: readonly string[]): ChildCommandLine {
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const binary = new URL(`../../bin/keelwerk${extension}`, import.meta.url);
  return {
    command: process.execPath,
    args: [...process.execArgv, fileURLToPath(binary), ...args],
  };
}
