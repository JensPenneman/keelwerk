// The fresh-clone check of roadmap exit criteria 1, 2 and 3: clones this repository into a
// temporary directory, installs from the frozen lockfile, starts `keelwerk dev` in examples/portal
// on PGlite, creates a backend and a tenant over the operator socket, signs up through REST on
// loopback, stores a session with `keelwerk login` and reads it back with `keelwerk call`. Every
// step prints `ok` with its duration; the first failure prints its output and exits 1. The
// temporary directory and every process the check started are gone when it ends, failure included.
//
//   node scripts/check-fresh-clone.ts [--offline] [--repo <path>]
//
// `--offline` installs from the local store (for a machine without a network; the report says so).
// `--repo` clones another repository than this one (a scratch copy of an uncommitted working tree).
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process, { env } from 'node:process';
import { fileURLToPath } from 'node:url';

interface Finished {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const stepLimitMs = 600_000;
const stopLimitMs = 90_000;
const backendSettings = {
  accounts: { allowSelfRegistration: true },
  auth: { addressAttemptsPerMinute: 1000 },
  rest: { docs: false, cors: [] },
};

function optionOf(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

const offline = process.argv.includes('--offline');
const source = optionOf('--repo') ?? fileURLToPath(new URL('..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'keelwerk-fresh-clone-'));
const clone = join(scratch, 'clone');
const portal = join(clone, 'examples', 'portal');
const configHome = join(scratch, 'config');
const environment: NodeJS.ProcessEnv = {
  ...env,
  ...Object.fromEntries([
    ['XDG_CONFIG_HOME', configHome],
    ['PORT', '0'],
  ]),
};

/** Runs a command to its end, with optional standard input; a hung command is killed at the limit. */
function run(
  command: string,
  args: readonly string[],
  cwd: string,
  stdin?: string,
): Promise<Finished> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), stepLimitMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin ?? '');
  });
}

function must(label: string, finished: Finished): string {
  if (finished.code !== 0) {
    throw new Error(
      `${label} exited ${finished.code}\n${finished.stdout.trim()}\n${finished.stderr.trim()}`,
    );
  }
  return finished.stdout;
}

/** The command line of `keelwerk` in the clone: the source condition replaces a build. */
function keelwerk(args: readonly string[], stdin?: string): Promise<Finished> {
  return run(
    process.execPath,
    ['--conditions=@keelwerk/source', join(clone, 'packages/cli/src/bin/keelwerk.ts'), ...args],
    portal,
    stdin,
  );
}

function jsonOf(label: string, text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${label} printed text that is not JSON:\n${text}`);
  }
}

function idOf(label: string, value: Record<string, unknown>): string {
  if (typeof value.id !== 'string')
    throw new Error(`${label} answered no id: ${JSON.stringify(value)}`);
  return value.id;
}

/** A running `keelwerk dev`: where it serves, and the way to stop it. */
interface RunningDev {
  readonly url: string;
  readonly socket: string;
  stop(): Promise<void>;
}

/** Starts `keelwerk dev` and resolves with its loopback address and operator socket once the app runs. */
async function startDev(): Promise<RunningDev> {
  const child: ChildProcess = spawn(
    process.execPath,
    [
      '--conditions=@keelwerk/source',
      join(clone, 'packages/cli/src/bin/keelwerk.ts'),
      'dev',
      '--no-types',
    ],
    { cwd: portal, env: environment, stdio: 'pipe', detached: true },
  );
  const closed = new Promise<void>((resolve) => child.on('close', () => resolve()));
  // Stops dev with the signal of `docker stop`, then kills what is left of its process group.
  const stop = async (): Promise<void> => {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const forced = setTimeout(() => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // the group is already gone
      }
    }, stopLimitMs);
    await closed;
    clearTimeout(forced);
  };
  try {
    const address = await new Promise<{ readonly url: string; readonly socket: string }>(
      (resolve, reject) => {
        let seen = '';
        const timer = setTimeout(
          () => reject(new Error(`dev did not start in time\n${seen}`)),
          stepLimitMs,
        );
        const onData = (chunk: Buffer): void => {
          seen += chunk.toString();
          const found = /app running at (http:\/\/127\.0\.0\.1:\d+), socket (\S+)/.exec(seen);
          if (found?.[1] !== undefined && found[2] !== undefined) {
            clearTimeout(timer);
            resolve({ url: found[1], socket: found[2] });
          }
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('close', (code) => {
          clearTimeout(timer);
          reject(new Error(`dev exited ${code} before the app ran\n${seen}`));
        });
      },
    );
    return { ...address, stop };
  } catch (failure) {
    await stop();
    throw failure;
  }
}

async function step(name: string, body: () => Promise<void>): Promise<void> {
  const began = performance.now();
  await body();
  process.stdout.write(`ok  ${name}  ${Math.round(performance.now() - began)} ms\n`);
}

async function main(): Promise<void> {
  const person = {
    identifier: `ada.${crypto.randomUUID().slice(0, 8)}@example.org`,
    password: `a long password ${crypto.randomUUID()}`,
    displayName: 'ada',
  };
  let running: RunningDev | undefined;
  try {
    const url = (): string => running?.url ?? '';
    await step('clone', async () => {
      must(
        'git clone',
        await run('git', ['clone', '--depth', '1', `file://${source}`, clone], scratch),
      );
    });
    await step(`install${offline ? ' (offline store)' : ''}`, async () => {
      must(
        'pnpm install',
        await run(
          'pnpm',
          ['install', '--frozen-lockfile', ...(offline ? ['--offline'] : [])],
          clone,
        ),
      );
    });
    await step('generate --check', async () => {
      const out = must(
        'generate --check',
        await keelwerk(['generate', '--check', '--output', 'json']),
      );
      const report = jsonOf('generate --check', out);
      if (!Array.isArray(report.failures) || report.failures.length !== 0) {
        throw new Error(`generate --check reported failures: ${out.trim()}`);
      }
    });
    await step('dev starts on PGlite', async () => {
      running = await startDev();
    });
    await step('backend create', async () => {
      const out = must(
        'backend create',
        await keelwerk([
          'backend',
          'create',
          'portal',
          '--app',
          'portal',
          '--placement',
          'default',
          '--settings',
          JSON.stringify(backendSettings),
          '--output',
          'json',
        ]),
      );
      idOf('backend create', jsonOf('backend create', out));
    });
    await step('tenant create', async () => {
      const out = must(
        'tenant create',
        await keelwerk([
          'tenant',
          'create',
          'acme',
          '--backend',
          'portal',
          '--domain',
          '127.0.0.1',
          '--output',
          'json',
        ]),
      );
      idOf('tenant create', jsonOf('tenant create', out));
    });
    await step('sign up over REST', async () => {
      const response = await fetch(`${url()}/api/auth/sign-up`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(person),
      });
      const body = await response.text();
      if (response.status !== 200 || !body.includes('credentialId')) {
        throw new Error(`sign-up answered ${response.status}: ${body}`);
      }
    });
    await step('login into a remote profile', async () => {
      mkdirSync(join(configHome, 'keelwerk'), { recursive: true });
      writeFileSync(
        join(configHome, 'keelwerk', 'profiles.json'),
        JSON.stringify({ current: 'portal', profiles: { portal: { url: url() } } }),
      );
      const out = must(
        'login',
        await keelwerk(
          ['login', '--input', JSON.stringify({ identifier: person.identifier })],
          `${person.password}\n`,
        ),
      );
      if (out.includes(person.password)) throw new Error('login printed the password');
    });
    await step('call with the stored session', async () => {
      const out = must('call', await keelwerk(['call', 'auth.whoami', '--output', 'json']));
      const who = jsonOf('call', out);
      if (who.displayName !== person.displayName) {
        throw new Error(`auth.whoami answered ${out.trim()}`);
      }
    });
    await step('dev stops', async () => {
      await running?.stop();
    });
  } finally {
    await running?.stop();
  }
}

try {
  await main();
  process.stdout.write('fresh clone check passed\n');
} catch (failure) {
  process.stderr.write(`failed: ${failure instanceof Error ? failure.message : String(failure)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
