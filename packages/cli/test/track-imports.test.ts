import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { lastStepOf } from '../src/dev/last-step-of.ts';
import { nameHangingImport } from '../src/dev/name-hanging-import.ts';
import { startProbe } from '../src/dev/start-probe.ts';
import { createNodeHost } from '../src/host/create-node-host.ts';

const trackImportsUrl = new URL('../src/dev/track-imports.ts', import.meta.url).href;
const eventMarkerUrl = new URL('../src/dev/event-marker.ts', import.meta.url).href;
let directory: string;

beforeAll(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'keelwerk-track-imports-')));
  writeFileSync(join(directory, 'shared.ts'), 'export const shared = 1;\n');
  writeFileSync(
    join(directory, 'hangs.ts'),
    [
      "import { shared } from './shared.ts';",
      // The tracker's own module, which was evaluated before the hooks existed, imported again by project code.
      `import ${JSON.stringify(eventMarkerUrl)};`,
      `import ${JSON.stringify(trackImportsUrl)};`,
      "process.stdout.write('waiting\\n');",
      'await new Promise<never>(() => setInterval(() => undefined, 1000));',
      'export const value = shared;',
      '',
    ].join('\n'),
  );
  // A module that names `process` itself, as an entity definition may.
  writeFileSync(join(directory, 'process.ts'), 'export const process = { stderr: undefined };\n');
  writeFileSync(
    join(directory, 'fine.ts'),
    "import { process } from './process.ts';\nexport const fine = process;\n",
  );
  writeFileSync(
    join(directory, 'hangs.cjs'),
    "process.stdout.write('waiting\\n');\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);\nmodule.exports = {};\n",
  );
  writeFileSync(join(directory, 'common.cjs'), 'module.exports = { fine: 1 };\n');
  writeFileSync(join(directory, 'data.json'), '{"a":1}\n');
  writeFileSync(
    join(directory, 'json.ts'),
    "import data from './data.json' with { type: 'json' };\nexport const json = data;\n",
  );
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** Runs a module of the scratch directory under the tracker, which the command installs first; stops it when it prints `waiting` or ends. */
function trackedRun(entry: string): Promise<string> {
  const script = [
    `(await import(${JSON.stringify(trackImportsUrl)})).trackImports();`,
    `await import(${JSON.stringify(pathToFileURL(join(directory, entry)).href)});`,
  ].join('\n');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      stdio: 'pipe',
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('waiting')) child.kill('SIGKILL');
    });
    child.once('error', reject);
    child.once('close', () => resolve(stderr));
  });
}

describe('the import tracker, in a real process', () => {
  test('names the module that hangs, not one that finished or the tracker itself', async () => {
    const stderr = await trackedRun('hangs.ts');
    expect(nameHangingImport(stderr)).toBe(join(directory, 'hangs.ts'));
  });

  test('reports a module that is finished, also when it shadows `process`', async () => {
    const stderr = await trackedRun('fine.ts');
    expect(stderr).toContain(`done ${pathToFileURL(join(directory, 'fine.ts')).href}`);
    expect(nameHangingImport(stderr)).toBeUndefined();
  });
});

describe('the import tracker and files that are not ES modules', () => {
  test('a JSON file is reported done at once, so it never counts as an import in flight', async () => {
    const stderr = await trackedRun('json.ts');
    expect(stderr).toContain(`done ${pathToFileURL(join(directory, 'data.json')).href}`);
    expect(nameHangingImport(stderr)).toBeUndefined();
  });
});

describe('the import tracker and CommonJS files', () => {
  test('a CommonJS file is reported done after it was evaluated', async () => {
    const url = pathToFileURL(join(directory, 'common.cjs')).href;
    const stderr = await trackedRun('common.cjs');
    expect(stderr).toContain(`done ${url}`);
    expect(stderr.indexOf('import')).toBeLessThan(stderr.indexOf('done'));
    expect(nameHangingImport(stderr)).toBeUndefined();
  });

  test('a CommonJS file that hangs is named, not reported done at load time', async () => {
    const stderr = await trackedRun('hangs.cjs');
    expect(stderr).not.toContain(`done ${pathToFileURL(join(directory, 'hangs.cjs')).href}`);
    expect(nameHangingImport(stderr)).toBe(join(directory, 'hangs.cjs'));
  });
});

describe('the last step a child reported', () => {
  test('is the last step line, whatever else was printed', () => {
    const stderr = [
      '@keelwerk-event import - file:///p/a.ts',
      '@keelwerk-event step loaded the deployment',
      'a warning',
      '@keelwerk-event step produced the API surfaces',
      '@keelwerk-event done file:///p/a.ts',
    ].join('\n');
    expect(lastStepOf(stderr)).toBe('produced the API surfaces');
  });

  test('is read when a module wrote text without a newline just before it', () => {
    const stderr =
      'partial\n@keelwerk-event step loaded the deployment\n\n@keelwerk-event step produced it\n';
    expect(lastStepOf(stderr)).toBe('produced it');
    expect(nameHangingImport(`partial\n@keelwerk-event import - file:///p/a.ts\n`)).toBe('/p/a.ts');
  });

  test('is undefined when the child reported none', () => {
    expect(lastStepOf('@keelwerk-event import - file:///p/a.ts\n')).toBeUndefined();
  });
});

describe('the probe, in a real process', () => {
  // Long enough for a loaded machine to start the child and load the modules before the limit counts as a hang.
  const importLimitMs = 3000;

  test('a module that hangs at import time fails the probe within its limit and is named', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'keelwerk-probe-hang-')));
    try {
      const hanging = join(root, 'hanging-module.ts');
      writeFileSync(
        hanging,
        'await new Promise<never>(() => setInterval(() => undefined, 1000));\nexport const value = 1;\n',
      );
      const deployment = join(root, 'deployment.ts');
      writeFileSync(
        deployment,
        "import { value } from './hanging-module.ts';\nexport default { value };\n",
      );
      const started = Date.now();
      const outcome = await startProbe(
        createNodeHost(),
        { root, deployment, now: 0, contract: false },
        importLimitMs,
      );
      expect(Date.now() - started).toBeLessThan(45_000);
      expect(outcome.kind).toBe('failed');
      if (outcome.kind === 'failed') {
        expect(outcome.message).toContain(hanging);
        expect(outcome.message).toContain(`made no progress for ${importLimitMs / 1000} seconds`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 90_000);
});
