import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process, { env } from 'node:process';
import { fileURLToPath } from 'node:url';

const cliBin = fileURLToPath(
  new URL('../../../../../../packages/cli/src/bin/keelwerk.ts', import.meta.url),
);
const deploymentFile = fileURLToPath(
  new URL('../../../../.launchway/deployment.ts', import.meta.url),
);
const startLimitMs = 120_000;
const stopLimitMs = 60_000;

function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('close', () => resolve());
  });
}

/** What a finished `keelwerk` command printed. */
export interface CliRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** A running `keelwerk dev` of the portal, in a scratch project root, and the way to drive the CLI against it. */
export interface DevSession {
  /** The loopback address the app serves on. */
  readonly url: string;
  /** The operator socket of the dev run. */
  readonly socket: string;
  /** The directory profiles and credentials are kept in. */
  readonly configHome: string;
  /** Runs `keelwerk <args>` in the scratch project, with the profile files of `configHome`. */
  keelwerk(
    args: readonly string[],
    options?: { readonly stdin?: string; readonly configHome?: string },
  ): Promise<CliRun>;
  /** Writes `profiles.json` into a config directory. */
  writeProfiles(
    profiles: Readonly<Record<string, { readonly url: string }>>,
    current: string,
    configHome?: string,
  ): void;
  stop(): Promise<void>;
}

/**
 * Starts `keelwerk dev` on PGlite for the portal's deployment file. The project root is a scratch
 * directory that holds a workspace marker and a one-line deployment file re-exporting the
 * portal's, so the dev state (`.keelwerk/`) and the watcher stay out of the repository.
 */
export async function startDevSession(): Promise<DevSession> {
  const root = mkdtempSync(join(tmpdir(), 'keelwerk-portal-session-'));
  // Profiles live beside the project root, not in it: the dev watcher restarts the app on a change below the root.
  const configHome = mkdtempSync(join(tmpdir(), 'keelwerk-portal-config-'));
  mkdirSync(join(root, '.launchway'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  writeFileSync(
    join(root, '.launchway', 'deployment.ts'),
    `export { default } from ${JSON.stringify(deploymentFile)};\n`,
  );
  const environment: NodeJS.ProcessEnv = {
    ...env,
    ...Object.fromEntries([
      ['PORT', '0'],
      ['XDG_CONFIG_HOME', configHome],
    ]),
  };
  const dev = spawn(
    process.execPath,
    ['--conditions=@keelwerk/source', cliBin, 'dev', '--no-types'],
    {
      cwd: root,
      env: environment,
      stdio: 'pipe',
      detached: true,
    },
  );
  const stop = async (): Promise<void> => {
    if (dev.exitCode === null && dev.signalCode === null) {
      dev.kill('SIGTERM');
      const forced = setTimeout(() => {
        try {
          if (dev.pid !== undefined) process.kill(-dev.pid, 'SIGKILL');
        } catch {
          // the group is already gone
        }
      }, stopLimitMs);
      await exited(dev);
      clearTimeout(forced);
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(configHome, { recursive: true, force: true });
  };
  let address: { readonly url: string; readonly socket: string };
  try {
    address = await new Promise((resolve, reject) => {
      let seen = '';
      const timer = setTimeout(
        () => reject(new Error(`dev did not start in time\n${seen}`)),
        startLimitMs,
      );
      const onData = (chunk: Buffer): void => {
        seen += chunk.toString();
        const found = /app running at (http:\/\/127\.0\.0\.1:\d+), socket (\S+)/.exec(seen);
        if (found?.[1] !== undefined && found[2] !== undefined) {
          clearTimeout(timer);
          resolve({ url: found[1], socket: found[2] });
        }
      };
      dev.stdout.on('data', onData);
      dev.stderr.on('data', onData);
      dev.once('close', (code) => {
        clearTimeout(timer);
        reject(new Error(`dev exited ${code} before the app ran\n${seen}`));
      });
    });
  } catch (failure) {
    await stop();
    throw failure;
  }
  return {
    ...address,
    configHome,
    keelwerk: (args, options = {}) =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--conditions=@keelwerk/source', cliBin, ...args], {
          cwd: root,
          env: {
            ...environment,
            ...Object.fromEntries([['XDG_CONFIG_HOME', options.configHome ?? configHome]]),
          },
          stdio: 'pipe',
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once('error', reject);
        child.once('close', (code) => resolve({ code, stdout, stderr }));
        child.stdin.end(options.stdin ?? '');
      }),
    writeProfiles: (profiles, current, home = configHome) => {
      mkdirSync(join(home, 'keelwerk'), { recursive: true });
      writeFileSync(join(home, 'keelwerk', 'profiles.json'), JSON.stringify({ current, profiles }));
    },
    stop,
  };
}
