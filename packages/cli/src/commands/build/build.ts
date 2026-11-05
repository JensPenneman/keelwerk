import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import type { FlagParameter } from '../../routes/flag-parameter.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { textFlag } from '../../routes/text-flag.ts';
import { findWorkspaceRoot } from '../doctor/find-workspace-root.ts';
import { buildSteps } from './build-steps.ts';
import { runBuildStep } from './run-build-step.ts';

const defaultBase = 'origin/main';

/**
 * `build [--base <ref>]` (sections 13.8 and 16.9.7): the checks of CI that run locally, in order,
 * stopping at the first that fails, and with `tsc -b` the emitted JavaScript. The surface diff
 * runs when the base exists; a project with no such commit has nothing released to compare with.
 */
export const buildCommandOf: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: {
    brief: 'Run the checks of CI locally, then emit JavaScript.',
    fullDescription: [
      'build                      biome ci, knip, the layout pass, tsc -b, vitest run, generate --check,',
      '                           db check and surface diff against origin/main; the first failure stops it',
      'build --base <ref>         compare the API surfaces with another git ref',
    ].join('\n'),
  },
  parameters: {
    flags: {
      base: textFlag(
        `The git ref the API surfaces are compared with (default ${defaultBase}).`,
        'ref',
      ),
    } satisfies Record<string, FlagParameter>,
  } as never,
  async func(this: CliContext, parsed) {
    try {
      const root = await findWorkspaceRoot(this.host);
      const base = typeof parsed.base === 'string' ? parsed.base : defaultBase;
      const out = {
        stdout: (text: string) => this.process.stdout.write(text),
        stderr: (text: string) => this.process.stderr.write(text),
      };
      const hasBase = await runBuildStep(
        this.host,
        root,
        { command: 'git', args: ['rev-parse', '--verify', '--quiet', `${base}^{commit}`] },
        { stdout: () => undefined, stderr: () => undefined },
      );
      if (!hasBase) {
        this.output.note(`skipping the surface diff: ${base} is not a commit of this repository`);
      }
      const steps = buildSteps(hasBase ? base : undefined);
      for (const [index, step] of steps.entries()) {
        this.output.line(`[${index + 1}/${steps.length}] ${step.title}`);
        if (!(await runBuildStep(this.host, root, step, out))) {
          this.output.note(`build failed at ${step.title}`);
          this.process.exitCode = 1;
          return;
        }
      }
      this.output.line('build passed; dist holds the emitted JavaScript');
    } catch (failure) {
      handleFailure(this, failure);
    }
  },
});
