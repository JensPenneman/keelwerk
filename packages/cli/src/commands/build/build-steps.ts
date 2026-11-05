import type { BuildStep } from './build-step.ts';
import { selfCommand } from './self-command.ts';

function tool(title: string, args: readonly string[]): BuildStep {
  return { title, command: 'pnpm', args: ['exec', ...args] };
}

function own(title: string, args: readonly string[]): BuildStep {
  return { title, ...selfCommand(args) };
}

/**
 * The checks `keelwerk build` runs locally, in the order of section 13.8: step 2 (`biome ci`,
 * `knip`, the layout pass), step 3 (`tsc -b`, which also emits `dist`), step 4 (`vitest run`),
 * step 5 (`generate --check`), step 6 (`db check`) and, with a base to compare with, step 9
 * (`surface diff`). Steps 1, 7 and 8 belong to CI alone.
 */
export function buildSteps(base: string | undefined): readonly BuildStep[] {
  return [
    tool('2a biome ci', ['biome', 'ci', '.']),
    tool('2b knip', ['knip']),
    own('2c layout pass', ['doctor', '--layout']),
    tool('3 tsc -b (checks and emits dist)', ['tsc', '-b']),
    tool('4 vitest run', ['vitest', 'run']),
    own('5 generate --check', ['generate', '--check']),
    own('6 db check', ['db', 'check']),
    ...(base === undefined
      ? []
      : [own(`9 surface diff against ${base}`, ['surface', 'diff', '--base', base])]),
  ];
}
