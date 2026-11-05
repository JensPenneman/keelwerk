import { resolve } from 'node:path';
import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { planInit } from '../../init/plan-init.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { writeScaffold } from '../../scaffold/write-scaffold.ts';
import { initFlagParameters } from './init-flag-parameters.ts';
import type { InitFlags } from './init-flags.ts';
import { initNamesOf } from './init-names-of.ts';

/**
 * `init [dir]` (section 16.9.7): creates a project in the canonical layout of section 23.1 and
 * never overwrites a file. The module and the app are the scaffolds of `keelwerk new`.
 */
export const initCommand: Command<CliContext> = buildCommand<InitFlags, [string?], CliContext>({
  docs: {
    brief: 'Create a project: workspace, Biome preset, .launchway/, one app and one module.',
    fullDescription:
      'Example: keelwerk init my-platform --scope @acme\nThen: cd my-platform && pnpm install && pnpm keelwerk dev',
  },
  parameters: {
    flags: initFlagParameters,
    positional: {
      kind: 'tuple',
      parameters: [
        {
          brief: 'The directory (default: here).',
          parse: String,
          placeholder: 'dir',
          optional: true,
        },
      ],
    },
  },
  async func(this: CliContext, flags: InitFlags, directory?: string) {
    try {
      const target = resolve(this.host.cwd, directory ?? '.');
      const names = initNamesOf(target, flags);
      const files = planInit(names);
      const dry = flags['dry-run'] === true;
      if (!dry) await writeScaffold(target, files);
      for (const file of files) this.output.line(`${dry ? 'would create' : 'create'} ${file.path}`);
      if (!dry) {
        this.output.line(
          `next: ${directory === undefined ? '' : `cd ${directory} && `}pnpm install && pnpm exec keelwerk generate && pnpm exec keelwerk dev`,
        );
      }
    } catch (failure) {
      handleFailure(this, failure);
    }
  },
});
