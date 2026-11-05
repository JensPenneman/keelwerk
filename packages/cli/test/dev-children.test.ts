import { describe, expect, test } from 'vitest';
import type { CliHost, HostExit, HostSpawnOptions } from '../src/context/cli-host.ts';
import { confirmContract } from '../src/dev/confirm-contract.ts';
import { resultMarker } from '../src/dev/result-marker.ts';
import { startProbe } from '../src/dev/start-probe.ts';
import { createFakeHost } from './support/fake-host.ts';

const options = {
  root: '/project',
  deployment: '/project/.keelwerk/dev-deployment.ts',
  now: 0,
  contract: false,
};
const quiet: HostExit = { code: 0, signal: null };

/** A spawn whose child writes `stdout` and `stderr`, then ends with `exit`; or never ends when `exit` is undefined. */
function spawning(
  stdout: string,
  stderr: string,
  exit: HostExit | undefined,
): {
  readonly spawn: CliHost['spawn'];
  readonly killed: string[];
} {
  const killed: string[] = [];
  return {
    killed,
    spawn: (_command: string, _args: readonly string[], spawnOptions: HostSpawnOptions) => {
      spawnOptions.onStdout?.(stdout);
      spawnOptions.onStderr?.(stderr);
      let end: (value: HostExit) => void = () => undefined;
      const exited = new Promise<HostExit>((resolve) => {
        end = resolve;
        if (exit !== undefined) resolve(exit);
      });
      return {
        exited,
        kill: (signal = 'SIGTERM') => {
          killed.push(signal);
          end({ code: null, signal });
        },
      };
    },
  };
}

describe('the probe child', () => {
  test('reports the producers and the synchronisation it printed', async () => {
    const result = {
      producers: { written: ['a.ts'], notes: [], failures: [] },
      sync: { applied: [], deferred: [], warnings: [] },
    };
    const child = spawning(`noise\n\n${resultMarker} ${JSON.stringify(result)}\n`, '', quiet);
    const fake = createFakeHost({ spawn: child.spawn });
    expect(await startProbe(fake.host, options)).toEqual({ kind: 'done', result });
  });

  test('a failed probe says what the child printed, without the events', async () => {
    const child = spawning(
      '',
      '@keelwerk-event import - file:///p/a.ts\napp.ts could not be loaded\n',
      { code: 1, signal: null },
    );
    const fake = createFakeHost({ spawn: child.spawn });
    expect(await startProbe(fake.host, options)).toEqual({
      kind: 'failed',
      message: 'app.ts could not be loaded',
    });
  });

  test('a probe that outlives its limit is killed and names the import it waits on', async () => {
    const child = spawning(
      '',
      [
        '@keelwerk-event import - file:///p/.keelwerk/dev-deployment.ts',
        '@keelwerk-event import file:///p/.keelwerk/dev-deployment.ts file:///p/modules/m/src/slow.ts',
      ].join('\n'),
      undefined,
    );
    const fake = createFakeHost({ spawn: child.spawn });
    const probing = startProbe(fake.host, options, 10_000);
    await Promise.resolve();
    const timer = fake.timers.find((candidate) => candidate.milliseconds === 10_000);
    expect(timer).toBeDefined();
    timer?.fire();
    const outcome = await probing;
    expect(child.killed).toEqual(['SIGKILL']);
    expect(outcome).toEqual({
      kind: 'failed',
      message:
        'the probe did not finish within 10 seconds, while it evaluated /p/modules/m/src/slow.ts; module definitions must be free of I/O at import time',
    });
  });
});

describe('the confirmation of contract steps', () => {
  test('is asked in a terminal and needs a yes', async () => {
    const asked: string[] = [];
    const fake = createFakeHost({ stdinInteractive: true, line: 'y' });
    const host = {
      ...fake.host,
      promptLine: async (label: string) => {
        asked.push(label);
        return 'y';
      },
    };
    expect(await confirmContract(host, ['main/shop: shop.core 0002'])).toBe(true);
    expect(asked[0]).toContain('main/shop: shop.core 0002');
    const declined = createFakeHost({ stdinInteractive: true, line: '' });
    expect(await confirmContract(declined.host, ['x'])).toBe(false);
  });

  test('is not asked without a terminal', async () => {
    const fake = createFakeHost({ stdinInteractive: false, line: 'y' });
    expect(await confirmContract(fake.host, ['x'])).toBe(false);
  });
});
