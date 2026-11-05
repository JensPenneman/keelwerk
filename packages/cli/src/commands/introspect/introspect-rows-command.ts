import type { ApiSurface } from '@keelwerk/core';
import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { introspectFlags } from './introspect-flags.ts';

/** An introspect command that prints rows derived from the connected deployment's surface. */
export function introspectRowsCommand(
  brief: string,
  rows: (surface: ApiSurface) => unknown,
): Command<CliContext> {
  return buildCommand<Readonly<Record<string, unknown>>, [], CliContext>({
    docs: { brief },
    parameters: { flags: introspectFlags() } as never,
    func(this: CliContext, parsed) {
      const scoped = scopeOutput(this, parsed);
      try {
        scoped.output.value(rows(scoped.surface));
      } catch (failure) {
        handleFailure(scoped, failure);
      }
    },
  });
}
