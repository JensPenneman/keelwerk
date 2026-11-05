import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, test } from 'vitest';
import { createNodeHost } from '../src/host/create-node-host.ts';

describe('the node host runs processes', () => {
  test('spawn hands over the output and the exit code', async () => {
    const host = createNodeHost();
    let out = '';
    const child = host.spawn(process.execPath, ['-e', 'console.log("hi"); process.exitCode = 3'], {
      onStdout: (text) => {
        out += text;
      },
    });
    expect(await child.exited).toEqual({ code: 3, signal: null });
    expect(out).toBe('hi\n');
  });

  test('spawn ends with 127 for a program that does not exist, and kill stops a child', async () => {
    const host = createNodeHost();
    let err = '';
    const missing = host.spawn('keelwerk-no-such-program', [], {
      onStderr: (text) => {
        err += text;
      },
    });
    expect((await missing.exited).code).toBe(127);
    expect(err).toContain('ENOENT');
    const waiting = host.spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], {});
    waiting.kill('SIGTERM');
    expect((await waiting.exited).signal).toBe('SIGTERM');
  });

  test('schedule fires once and can be cancelled', async () => {
    const host = createNodeHost();
    const fired = await new Promise<string>((resolve) => {
      host.schedule(5, () => resolve('fired'));
    });
    expect(fired).toBe('fired');
    let late = false;
    const cancel = host.schedule(5, () => {
      late = true;
    });
    cancel();
    await host.sleep(30);
    expect(late).toBe(false);
  });

  test('watchTree reports changed paths relative to the root, nested ones included', async () => {
    const root = await mkdtemp(join(tmpdir(), 'keelwerk-watch-'));
    try {
      await mkdir(join(root, 'modules', 'a'), { recursive: true });
      const host = createNodeHost();
      const seen: string[] = [];
      const changed = new Promise<void>((resolve) => {
        const watcher = host.watchTree(root, (path) => {
          seen.push(path);
          if (path.endsWith('x.ts')) {
            watcher.close();
            resolve();
          }
        });
      });
      // The file system watcher needs a moment before it sees a file that is written right away.
      await host.sleep(300);
      await writeFile(join(root, 'modules', 'a', 'x.ts'), 'export {};\n');
      await changed;
      expect(seen).toContain('modules/a/x.ts');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
