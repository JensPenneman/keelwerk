import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import clean from '../layout-fixtures/clean.json' with { type: 'json' };
import { materialise, writeManifests } from '../layout-fixtures/materialise-tree.ts';
import { createFakeHost, type FakeHost, type FakeHostOptions } from './fake-host.ts';
import { pnpmAnswerOf } from './pnpm-answer.ts';
import { runCliWith } from './run-cli-with.ts';
import { stepTimers } from './step-timers.ts';

/** The conventions workspace with only the module that imports no other (the artefact check loads each module by its package name), and with the tools the environment check looks for: no error of the project is left to decide the exit code. */
function soundProjectFiles(): Record<string, string> {
  const modules = Object.entries(clean.files).filter(
    ([path]) => !path.startsWith('apps/') && !path.startsWith('packages/module-shop/'),
  );
  return {
    ...Object.fromEntries(modules),
    'node_modules/typescript/package.json': '{"version":"7.0.2"}',
    'node_modules/@biomejs/biome/package.json': '{"version":"2.6.3"}',
  };
}

/** What a run of the doctor command can set besides its arguments and its deployment file. */
export interface DoctorRunOptions {
  /** The workspace has only what the environment check looks for, so no error of the project is left to decide the exit code. */
  readonly soundProject?: boolean;
  readonly pnpmVersion?: string;
  /** What the host's environment holds besides the master key. */
  readonly environment?: Readonly<Record<string, string>>;
  /** What the host answers for a process it is asked to start. */
  readonly spawn?: NonNullable<FakeHostOptions['spawn']>;
  /** Called with the fake host as soon as it exists, so that a case can look at the timers the command schedules. */
  readonly onHost?: (host: FakeHost) => void;
  /** Fires every timer the command schedules as soon as it exists, so that deadlines pass: at once for true, or once the given promise has settled. */
  readonly stepTimers?: boolean | Promise<unknown>;
}

/** Runs the whole doctor command in this process, over files in a scratch directory, with a fake host that answers the one process it is asked for (pnpm). The deployment file is `config` (none when null) in a directory next to the tests, so that its imports resolve. */
export async function runDoctorCommand(
  argv: readonly string[],
  config: string | null,
  options: DoctorRunOptions = {},
) {
  const { soundProject = false, pnpmVersion = '11.21.0', environment = {} } = options;
  const spawn = options.spawn ?? pnpmAnswerOf(pnpmVersion);
  const dir = await materialise(soundProject ? soundProjectFiles() : clean.files);
  await writeManifests(dir);
  const here = dirname(fileURLToPath(import.meta.url));
  const configDir = await mkdtemp(join(here, '..', '.doctor-config-'));
  try {
    const path = join(configDir, 'keelwerk.config.ts');
    if (config !== null) await writeFile(path, config);
    const host = createFakeHost({
      spawn,
      cwd: dir,
      env: Object.fromEntries([['KW_KEY', 'x'], ...Object.entries(environment)]),
      files: {
        [`${dir}/pnpm-workspace.yaml`]: 'packages:\n  - packages/*\n',
        ...(config === null ? {} : { [path]: '' }),
      },
    });
    options.onHost?.(host);
    const running = runCliWith(['doctor', '--config', path, ...argv], host.host);
    return await (options.stepTimers === undefined || options.stepTimers === false
      ? running
      : stepTimers(host, running, options.stepTimers === true ? undefined : options.stepTimers));
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
}
