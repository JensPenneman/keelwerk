import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { introspectFlags } from './introspect-flags.ts';
import { moduleRows } from './module-rows.ts';

/** `introspect` (section 16.9.7): the app, its API version and its modules with their entities and actions, as a tree on a terminal and as JSON otherwise. */
export const introspectSummaryCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: { brief: 'Show the surface as a tree.' },
  parameters: { flags: introspectFlags() } as never,
  func(this: CliContext, parsed) {
    const scoped = scopeOutput(this, parsed);
    try {
      const { surface } = scoped;
      if (scoped.output.format !== 'text' && scoped.output.format !== 'table') {
        scoped.output.value({
          app: surface.app,
          apiVersion: surface.apiVersion,
          hash: surface.hash,
          modules: moduleRows(surface),
        });
        return;
      }
      scoped.output.line(`${surface.app} @ ${surface.apiVersion}`);
      for (const module of surface.modules) {
        scoped.output.line(`  ${module.id} ${module.version}`);
        for (const entity of surface.entities.filter((entry) => entry.module === module.id)) {
          scoped.output.line(`    entity ${entity.ref}`);
        }
        for (const action of surface.actions.filter((entry) => entry.module === module.id)) {
          scoped.output.line(`    ${action.kind} ${action.ref}`);
        }
      }
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
