import type { SurfaceAction } from '@keelwerk/core';
import type { Command, CommandBuilderArguments } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../context/cli-context.ts';
import { commonFlags } from './common-flags.ts';
import { exampleLine } from './example-line.ts';
import { flagFor } from './flag-for.ts';
import type { FlagParameter } from './flag-parameter.ts';
import { flagTable } from './flag-table.ts';
import { handleFailure } from './handle-failure.ts';
import { parserFor } from './parser-for.ts';
import type { PositionalSlot } from './positional-slot.ts';
import { runAction } from './run-action.ts';
import { scopeOutput } from './scope-output.ts';

type ActionFlags = Readonly<Record<string, unknown>>;
type ActionParameters = CommandBuilderArguments<
  ActionFlags,
  readonly unknown[],
  CliContext
>['parameters'];

/** The positional arguments: the id of an instance command, then the names `cli.positional` lists. */
function slotsOf(action: SurfaceAction): readonly PositionalSlot[] {
  const fields = action.input.kind === 'shape' ? action.input.fields : {};
  const names = [...(action.instance ? ['id'] : []), ...(action.hints.cli?.positional ?? [])];
  return names.flatMap((name) => {
    const node = fields[name];
    return node === undefined ? [] : [{ name, node }];
  });
}

/** The command of one action: flags from its input fields, the common flags, positionals, and the run. */
export function buildActionCommand(action: SurfaceAction, reference: string): Command<CliContext> {
  const entries = flagTable(action);
  const slots = slotsOf(action);
  const flags: Record<string, unknown> = { ...commonFlags() };
  for (const entry of entries) {
    flags[entry.key] =
      entry.role === 'negate'
        ? ({
            kind: 'boolean',
            brief: `Set ${entry.key.slice(3)} to false.`,
            optional: true,
            withNegated: false,
          } as unknown as FlagParameter)
        : flagFor(entry.key, entry.node);
  }
  const parameters = {
    flags,
    positional: {
      kind: 'tuple',
      parameters: slots.map((slot) => ({
        brief: slot.node.description ?? `${slot.name} (${slot.node.kind})`,
        placeholder: slot.name,
        optional: true,
        parse: parserFor(slot.node),
      })),
    },
  } as unknown as ActionParameters;
  return buildCommand<ActionFlags, readonly unknown[], CliContext>({
    docs: {
      brief: action.description ?? `${action.kind} ${action.ref}`,
      fullDescription: [
        action.description ?? action.ref,
        `Kind: ${action.kind}. Authorization: ${action.auth}. Scope: ${action.scope}.`,
        ...(action.errors.length > 0 ? [`Errors: ${action.errors.join(', ')}.`] : []),
        `Example: ${exampleLine(reference, slots, entries)}`,
      ].join('\n'),
    },
    parameters,
    async func(this: CliContext, parsed, ...positionals) {
      const scoped = scopeOutput(this, parsed);
      try {
        await runAction(scoped, action, entries, slots, parsed, positionals);
      } catch (failure) {
        handleFailure(scoped, failure);
      }
    },
  });
}
