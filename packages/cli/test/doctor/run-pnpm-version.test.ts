import { describe, expect, test } from 'vitest';
import type { HostExit, HostProcess, HostSpawnOptions } from '../../src/context/cli-host.ts';
import { runPnpmVersion } from '../../src/doctor/run-pnpm-version.ts';
import { createFakeHost } from '../support/fake-host.ts';

/** A child that prints `text` and ends with `exit` when its time comes, or ends with a signal when it is killed. */
function child(
  options: HostSpawnOptions,
  text: string,
  exit: HostExit | undefined,
): { readonly process: HostProcess; readonly killed: string[] } {
  const killed: string[] = [];
  let end: (value: HostExit) => void = () => undefined;
  const exited = new Promise<HostExit>((resolve) => {
    end = resolve;
  });
  if (exit !== undefined) {
    options.onStdout?.(text);
    end(exit);
  }
  return {
    killed,
    process: {
      exited,
      kill: (signal = 'SIGTERM') => {
        killed.push(signal);
        end({ code: null, signal });
      },
    },
  };
}

describe('the pnpm version doctor reads through the host', () => {
  test('the version pnpm prints, trimmed, from the command `pnpm --version` with the host environment', async () => {
    const asked: [string, readonly string[], HostSpawnOptions][] = [];
    const { host } = createFakeHost({
      env: Object.fromEntries([['PATH', '/bin']]),
      spawn: (command, args, options) => {
        asked.push([command, args, options]);
        return child(options, '11.21.0\n', { code: 0, signal: null }).process;
      },
    });
    expect(await runPnpmVersion(host)).toBe('11.21.0');
    expect(asked.map(([command, args]) => [command, args])).toEqual([['pnpm', ['--version']]]);
    expect(asked[0]?.[2].env).toEqual(Object.fromEntries([['PATH', '/bin']]));
  });

  test('a pnpm that cannot start or fails is none, whatever it printed', async () => {
    for (const code of [127, 1]) {
      const { host } = createFakeHost({
        spawn: (_command, _args, options) =>
          child(options, '11.21.0\n', { code, signal: null }).process,
      });
      expect(await runPnpmVersion(host)).toBeUndefined();
    }
  });

  test('a pnpm that does not end in fifteen seconds is killed and is none', async () => {
    let started: ReturnType<typeof child> | undefined;
    const fake = createFakeHost({
      spawn: (_command, _args, options) => {
        started = child(options, '', undefined);
        return started.process;
      },
    });
    const pending = runPnpmVersion(fake.host);
    expect(fake.timers.map((timer) => timer.milliseconds)).toEqual([15_000]);
    fake.timers[0]?.fire();
    expect(await pending).toBeUndefined();
    expect(started?.killed).toEqual(['SIGKILL']);
  });

  test('a pnpm that ends in time leaves no timer that could kill it', async () => {
    const fake = createFakeHost({
      spawn: (_command, _args, options) =>
        child(options, '11.21.0', { code: 0, signal: null }).process,
    });
    await runPnpmVersion(fake.host);
    expect(fake.timers.map((timer) => timer.cancelled)).toEqual([true]);
  });
});
