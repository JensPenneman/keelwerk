import { describe, expect, test } from 'vitest';
import { formatLogLine } from '../src/dev/format-log-line.ts';
import { isIgnoredChange } from '../src/dev/is-ignored-change.ts';
import { lineBuffer } from '../src/dev/line-buffer.ts';
import { nameHangingImport } from '../src/dev/name-hanging-import.ts';
import { statusLine } from '../src/dev/status-line.ts';
import { typeCheckerStatusOf } from '../src/dev/type-checker-status-of.ts';
import { watchWorkspace } from '../src/dev/watch-workspace.ts';
import { createFakeHost } from './support/fake-host.ts';

describe('which changes the supervisor ignores', () => {
  test.each([
    'node_modules/pino/index.js',
    'apps/shop/dist/app.js',
    'apps/shop/generated/cli/manifest.json',
    '.keelwerk/dev-deployment.ts',
    '.git/index',
    'modules/library/src/module.generated.ts',
    'modules/library/src/module.generated.ts.tmp',
    'apps/shop/tsconfig.tsbuildinfo',
  ])('%s', (path) => {
    expect(isIgnoredChange(path)).toBe(true);
  });

  test.each([
    'modules/library/src/actions/borrow.ts',
    '.launchway/deployment.ts',
    'apps/shop/src/modules.ts',
    'modules/library/package.json',
  ])('%s is a source', (path) => {
    expect(isIgnoredChange(path)).toBe(false);
  });
});

describe('the watch loop', () => {
  test('waits 100 ms for the changes to settle and reports each path once', async () => {
    let change: (path: string) => void = () => undefined;
    const fake = createFakeHost({
      watchTree: (_root, onChange) => {
        change = onChange;
        return { close: () => undefined };
      },
    });
    const settled: (readonly string[])[] = [];
    const batch = new Promise<void>((resolve) => {
      watchWorkspace(fake.host, '/project', (paths) => {
        settled.push(paths);
        resolve();
      });
    });
    change('modules/a/src/actions/x.ts');
    change('modules/a/src/actions/x.ts');
    change('modules/a/src/module.generated.ts');
    change('modules/a/src/actions/y.ts');
    await batch;
    expect(fake.sleeps).toEqual([100, 100, 100]);
    expect(settled).toEqual([['modules/a/src/actions/x.ts', 'modules/a/src/actions/y.ts']]);
  });
});

describe('the status line', () => {
  test('shows the restart time against the one-second target', () => {
    expect(
      statusLine({
        types: { kind: 'done', errors: 0 },
        app: 'running',
        port: 3000,
        socket: '.keelwerk/dev.sock',
        restartMs: 640,
      }),
    ).toBe(
      '[keelwerk] types ok | app running at http://127.0.0.1:3000, socket .keelwerk/dev.sock | restart 640 ms (target 1000 ms)',
    );
  });

  test('counts type errors and says when nothing is checked', () => {
    const base = {
      app: 'failed',
      port: undefined,
      socket: undefined,
      restartMs: undefined,
    } as const;
    expect(statusLine({ ...base, types: { kind: 'done', errors: 1 } })).toBe(
      '[keelwerk] types 1 error | app failed',
    );
    expect(statusLine({ ...base, types: { kind: 'off' } })).toBe(
      '[keelwerk] types off | app failed',
    );
  });
});

describe('what the type checker prints', () => {
  test.each([
    ['Found 0 errors. Watching for file changes.', { kind: 'done', errors: 0 }],
    ['Found 3 errors. Watching for file changes.', { kind: 'done', errors: 3 }],
    ['File change detected. Starting incremental compilation...', { kind: 'checking' }],
    ['apps/a/src/app.ts(3,1): error TS2304: Cannot find name.', undefined],
  ])('%s', (line, status) => {
    expect(typeCheckerStatusOf(line)).toEqual(status);
  });
});

describe('the app log as the terminal shows it', () => {
  test('an info line is its message, a warning carries its level, debug is dropped', () => {
    expect(formatLogLine('{"level":30,"msg":"POST /api/x → x.go 201 12 ms allow x.go.open"}')).toBe(
      'POST /api/x → x.go 201 12 ms allow x.go.open',
    );
    expect(formatLogLine('{"level":40,"time":1,"msg":"slow","ms":900}')).toBe(
      'warn: slow {"ms":900}',
    );
    expect(formatLogLine('{"level":20,"msg":"phase"}')).toBeUndefined();
    expect(formatLogLine('plain text')).toBe('plain text');
  });
});

describe('lines of child output', () => {
  test('are cut at line feeds across chunks and the rest is flushed', () => {
    const seen: string[] = [];
    const buffer = lineBuffer((line) => seen.push(line));
    buffer.push('one\ntw');
    buffer.push('o\r\nthree');
    buffer.flush();
    expect(seen).toEqual(['one', 'two', 'three']);
  });
});

describe('naming the import that hung', () => {
  const marker = '@keelwerk-event';
  test('is the first module that never finished and whose imports all finished', () => {
    const stderr = [
      `${marker} import - file:///p/.keelwerk/dev-deployment.ts`,
      `${marker} import file:///p/.keelwerk/dev-deployment.ts file:///p/apps/a/src/app.ts`,
      `${marker} import file:///p/apps/a/src/app.ts file:///p/modules/m/src/slow.ts`,
      `${marker} import file:///p/apps/a/src/app.ts file:///p/modules/m/src/fine.ts`,
      `${marker} done file:///p/modules/m/src/fine.ts`,
      'some other output',
    ].join('\n');
    expect(nameHangingImport(stderr)).toBe('/p/modules/m/src/slow.ts');
  });

  test('is undefined when every import finished', () => {
    const stderr = [`${marker} import - file:///p/a.ts`, `${marker} done file:///p/a.ts`].join(
      '\n',
    );
    expect(nameHangingImport(stderr)).toBeUndefined();
  });
});
