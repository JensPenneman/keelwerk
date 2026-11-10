import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process, { env } from 'node:process';
import { describe, expect, test } from 'vitest';
import type { CliHost } from '../src/context/cli-host.ts';
import { runSupervisor } from '../src/dev/supervisor.ts';
import { createNodeHost } from '../src/host/create-node-host.ts';
import { environmentOf } from './support/environment-of.ts';
import { createFakeHost } from './support/fake-host.ts';
import { useInitProjects } from './support/init-project.ts';
import { runCliWith } from './support/run-cli-with.ts';

const project = useInitProjects();

/** Lines the supervisor prints, and a way to wait for the next one that matches. */
function terminal(): {
  readonly lines: string[];
  readonly print: (line: string) => void;
  next(pattern: RegExp): Promise<string>;
} {
  const lines: string[] = [];
  const waiting: { pattern: RegExp; resolve: (line: string) => void }[] = [];
  return {
    lines,
    print: (line) => {
      lines.push(line);
      for (const wait of waiting.splice(0)) {
        if (wait.pattern.test(line)) wait.resolve(line);
        else waiting.push(wait);
      }
    },
    next: (pattern) => new Promise((resolve) => waiting.push({ pattern, resolve })),
  };
}

function hostIn(root: string): CliHost {
  return { ...createNodeHost(), cwd: root, env: { ...env, ...environmentOf(['PORT', '0']) } };
}

/** The refs of the actions the probe derived for the app (`generated/api-surface`), from the definitions the app child loads. */
async function derivedActions(root: string): Promise<string[]> {
  const text = await readFile(
    join(root, 'apps', 'shop', 'generated', 'api-surface', 'shop', '2026-11-04.json'),
    'utf8',
  );
  return (JSON.parse(text) as { actions: { ref: string }[] }).actions.map((action) => action.ref);
}

async function health(host: CliHost, socket: string): Promise<number> {
  const response = await host.fetchSocket(socket, '/_keelwerk/health', {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  return response.status;
}

describe('keelwerk dev', () => {
  test('starts a project from init on PGlite and mounts a part added during the run', async () => {
    const made = await project();
    const host = hostIn(made.root);
    const screen = terminal();
    const stop = new AbortController();
    const running = screen.next(/app running at/);
    const finished = runSupervisor({
      host,
      root: made.root,
      deploymentFile: join(made.root, '.launchway', 'deployment.ts'),
      print: screen.print,
      note: screen.print,
      signal: stop.signal,
      typeChecker: undefined,
    });
    try {
      const first = await running;
      const socket = /socket (\S+)/.exec(first)?.[1];
      expect(socket).toBeDefined();
      expect(first).toMatch(/restart \d+ ms \(target 1000 ms\)/);
      expect(await health(host, socket ?? '')).toBe(200);
      expect(await derivedActions(made.root)).not.toContain('starter.ping');

      const second = screen.next(/app running at/);
      const added = await runCliWith(
        ['new', 'action', 'starter.ping', '--kind', 'query'],
        createFakeHost({ cwd: made.root }).host,
      );
      expect(added.code).toBe(0);
      const again = await second;
      const manifest = await readFile(
        join(made.root, 'modules', 'starter', 'src', 'module.generated.ts'),
        'utf8',
      );
      expect(manifest).toContain('ping');
      const restart = /restart (\d+) ms \(target 1000 ms\)/.exec(again);
      expect(restart).not.toBeNull();
      process.stderr.write(`restart after adding a part: ${restart?.[1]} ms (target 1000 ms)\n`);
      const socketAgain = /socket (\S+)/.exec(again)?.[1] ?? '';
      expect(await health(host, socketAgain)).toBe(200);
      expect(await derivedActions(made.root)).toContain('starter.ping');
    } catch (failure) {
      process.stderr.write(`${screen.lines.join('\n')}\n`);
      throw failure;
    } finally {
      stop.abort();
      await finished;
    }
    expect(screen.lines.join('\n')).toContain('app running');
    expect(screen.lines.join('\n')).not.toContain('the app exited');
    expect(screen.lines.join('\n')).not.toContain('app failed');
  }, 300_000);

  test('starts again after an app that had to be killed left its registration behind', async () => {
    const made = await project();
    const node = hostIn(made.root);
    const host: CliHost = {
      ...node,
      spawn: (command, args, options) => {
        const child = node.spawn(command, args, options);
        return { exited: child.exited, kill: () => child.kill('SIGKILL') };
      },
    };
    const screen = terminal();
    const stop = new AbortController();
    const running = screen.next(/app running at/);
    const finished = runSupervisor({
      host,
      root: made.root,
      deploymentFile: join(made.root, '.launchway', 'deployment.ts'),
      print: screen.print,
      note: screen.print,
      signal: stop.signal,
      typeChecker: undefined,
    });
    try {
      await running;
      const second = screen.next(/app running at|app failed/);
      const added = await runCliWith(
        ['new', 'action', 'starter.pong', '--kind', 'query'],
        createFakeHost({ cwd: made.root }).host,
      );
      expect(added.code).toBe(0);
      expect(await second).toMatch(/app running at/);
    } catch (failure) {
      process.stderr.write(`${screen.lines.join('\n')}\n`);
      throw failure;
    } finally {
      stop.abort();
      await finished;
    }
  }, 300_000);
});
