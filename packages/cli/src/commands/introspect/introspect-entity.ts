import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { usageFailure } from '../../context/usage-failure.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { introspectFlags } from './introspect-flags.ts';

/** `introspect entity <ref>` (section 16.9.7): one entity of the surface with its fields, relations and generated actions. */
export const introspectEntityCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [string],
  CliContext
>({
  docs: { brief: 'Show one entity.' },
  parameters: {
    flags: introspectFlags(),
    positional: {
      kind: 'tuple',
      parameters: [{ brief: 'The entity reference.', parse: String, placeholder: 'ref' }],
    },
  } as never,
  func(this: CliContext, parsed, ref: string) {
    const scoped = scopeOutput(this, parsed);
    try {
      const entity = scoped.surface.entities.find((candidate) => candidate.ref === ref);
      if (entity === undefined) throw usageFailure(`The surface has no entity "${ref}".`);
      scoped.output.value({
        ref: entity.ref,
        module: entity.module,
        prefix: entity.prefix,
        history: entity.history,
        tenancy: entity.tenancy,
        generated: entity.generated.join(','),
        fields: Object.fromEntries(
          Object.entries(entity.fields).map(([name, node]) => [
            name,
            `${node.kind}${node.optional ? '?' : ''}`,
          ]),
        ),
        relations: Object.keys(entity.relations).join(','),
      });
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
