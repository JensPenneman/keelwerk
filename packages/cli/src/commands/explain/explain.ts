import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { CliFailure } from '../../context/cli-failure.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { buildExplainRequest } from './build-explain-request.ts';
import { explainFlags } from './explain-flags.ts';
import { renderExplanation } from './render-explanation.ts';

/**
 * `explain <ref> [--input ...] [--as <principal>] [--dry-run]` and `explain --trace <id>`
 * (section 16.9.7): asks the connected deployment's operator endpoint `core.explain` and prints
 * the answer. Without `--dry-run` nothing is executed; with it the command runs in a unit that
 * rolls back.
 */
export const explainCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [string?],
  CliContext
>({
  docs: {
    brief: 'Explain an authorization decision, dry-run a command, or trace one.',
    fullDescription: [
      'explain <ref> [--input json] [--as kind:id]   the decision, without executing',
      'explain <ref> --dry-run [--input json] [--as kind:id] [--answer effect=json]',
      '                                              events, effects and the decision record, rolled back',
      'explain --trace <command, event or effect id>  the tree the chain holds',
      '`--as` evaluates anywhere and runs a dry run only in development.',
    ].join('\n'),
  },
  parameters: {
    flags: explainFlags(),
    positional: {
      kind: 'tuple',
      parameters: [
        { brief: 'The action reference.', parse: String, placeholder: 'ref', optional: true },
      ],
    },
  } as never,
  async func(this: CliContext, parsed, ref?: string) {
    const scoped = scopeOutput(this, parsed);
    try {
      const request = await buildExplainRequest(scoped, parsed, ref);
      const response = await scoped.client.invoke('core.explain', request, {
        signal: scoped.signal,
      });
      if (!response.ok) throw new CliFailure(response.error, response.error.message);
      const value = response.value as Readonly<Record<string, unknown>>;
      if (scoped.output.format === 'text' || scoped.output.format === 'table') {
        scoped.output.line(renderExplanation(value));
      } else {
        scoped.output.value(value);
      }
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
