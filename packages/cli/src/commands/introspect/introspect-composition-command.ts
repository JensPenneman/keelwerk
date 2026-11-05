import type { CompositionReportDocument } from '@keelwerk/core';
import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { CliFailure } from '../../context/cli-failure.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { introspectFlags } from './introspect-flags.ts';

/**
 * An introspect command that prints part of the composition report (`core.composition`, section
 * 16.2.6): what the surface leaves out, such as the effective rules and the extension points.
 */
export function introspectCompositionCommand(
  brief: string,
  rows: (report: CompositionReportDocument) => unknown,
): Command<CliContext> {
  return buildCommand<Readonly<Record<string, unknown>>, [], CliContext>({
    docs: { brief },
    parameters: { flags: introspectFlags() } as never,
    async func(this: CliContext, parsed) {
      const scoped = scopeOutput(this, parsed);
      try {
        const response = await scoped.client.invoke(
          'core.composition',
          {},
          { signal: scoped.signal },
        );
        if (!response.ok) throw new CliFailure(response.error, response.error.message);
        scoped.output.value(rows(response.value as CompositionReportDocument));
      } catch (failure) {
        handleFailure(scoped, failure);
      }
    },
  });
}
