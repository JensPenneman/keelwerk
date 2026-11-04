import { execFile } from 'node:child_process';
import { mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { renderModuleManifest } from '@keelwerk/core/manifest';
import { afterEach, describe, expect, test } from 'vitest';
import { parseReference } from '../src/scaffold/parse-reference.ts';
import { createFakeHost } from './support/fake-host.ts';
import { useNewWorkspace } from './support/new-workspace.ts';
import { runCliWith } from './support/run-cli-with.ts';

const execFileAsync = promisify(execFile);
const workspace = useNewWorkspace();
const { runNew, listing, read } = workspace;

describe('references', () => {
  test('the first segment is the id, later segments become kebab-case names', () => {
    expect(parseReference('mail-store.mailboxEntry')).toEqual({
      target: 'mail-store',
      names: ['mailbox-entry'],
    });
    expect(parseReference('auth.credential.already-revoked').names).toEqual([
      'credential',
      'already-revoked',
    ]);
    expect(parseReference('auth').names).toEqual([]);
  });

  test('a module id that is not kebab-case is a usage mistake', () => {
    expect(() => parseReference('Mail.store')).toThrow(/kebab-case module id/);
  });
});

describe('kinds of later milestones', () => {
  test.each(['stream', 'topic', 'version-change'])(
    '%s names milestone M2 and exits 2',
    async (kind) => {
      const run = await runNew(kind, 'library.thing');
      expect(run.code).toBe(2);
      expect(run.stderr).toContain(`${kind} parts belong to milestone M2`);
    },
  );

  test('an unknown kind lists what M1 scaffolds', async () => {
    const run = await runNew('widget', 'library.thing');
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('Unknown kind "widget"');
  });
});

describe('new module', () => {
  test('writes the package of section 16.9.8 and the generated manifest', async () => {
    const run = await runNew('module', 'mail-store', '--scope', '@acme');
    expect(run.code).toBe(0);
    const files = await listing(join(workspace.root(), 'modules', 'mail-store'));
    expect(files).toEqual([
      'package.json',
      'src/base.ts',
      'src/module.generated.ts',
      'src/module.test-d.ts',
      'test/alone.test.ts',
      'tsconfig.json',
      'tsconfig.test.json',
      'vitest.config.ts',
    ]);
    const base = await read('modules/mail-store/src/base.ts');
    expect(base).toContain("id: 'mail-store'");
    expect(base).toContain('export const mailStoreBase: MailStoreBase = mailStoreBaseDef;');
    const manifest = await read('modules/mail-store/src/module.generated.ts');
    expect(manifest).toBe(
      renderModuleManifest({
        id: 'mail-store',
        generatorVersion: manifest.match(/by keelwerk (\S+) /)?.[1] ?? '',
        scanned: { parts: [], unplaced: [] },
        migrations: false,
      }),
    );
    const manifestJson = JSON.parse(await read('modules/mail-store/package.json')) as {
      devDependencies: Record<string, string>;
      name: string;
      exports: Record<string, Record<string, string>>;
      publishConfig: { exports: Record<string, Record<string, string>> };
    };
    expect(manifestJson.name).toBe('@acme/module-mail-store');
    expect(manifestJson.exports['.']?.['@keelwerk/source']).toBe('./src/module.generated.ts');
    expect(manifestJson.publishConfig.exports['.']).not.toHaveProperty('@keelwerk/source');
    expect(run.stdout).toContain('{ "path": "modules/mail-store" },');
    const alone = await read('modules/mail-store/test/alone.test.ts');
    expect(alone).toContain("from '@keelwerk/testing'");
    expect(alone).toContain('createLocalClient(runtime');
    const typeTest = await read('modules/mail-store/src/module.test-d.ts');
    expect(typeTest).toContain("from '@keelwerk/testing/types'");
    expect(typeTest).toContain('ExpectValidApp<typeof app>');
    expect(typeTest).toContain('HasEntity<typeof app,');
    expect(typeTest).toContain('HasAction<typeof app,');
    expect(manifestJson).toMatchObject({
      devDependencies: { '@keelwerk/testing': expect.any(String) },
    });
  });

  test('--requires and --optional shape the base, the references and the toggle type tests', async () => {
    await runNew(
      'module',
      'mail-store',
      '--scope',
      '@acme',
      '--requires',
      'mail-domains',
      '--optional',
      'accounts,teams',
      '--app',
      'portal',
    );
    const base = await read('modules/mail-store/src/base.ts');
    expect(base).toContain("import { mailDomains } from '@acme/module-mail-domains';");
    expect(base).toContain('requires: [mailDomains],');
    expect(base).toContain('optional: [accounts, teams],');
    const typeTest = await read('modules/mail-store/src/module.test-d.ts');
    expect(typeTest).toContain("test('alone'");
    expect(typeTest).toContain("test('with accounts'");
    expect(typeTest).toContain("test('with teams'");
    const tsconfig = JSON.parse(await read('modules/mail-store/tsconfig.json')) as {
      references: { path: string }[];
    };
    expect(tsconfig.references).toEqual([
      { path: '../mail-domains' },
      { path: '../accounts' },
      { path: '../teams' },
    ]);
    const run = await runNew('module', 'other', '--scope', '@acme', '--app', 'portal');
    expect(run.stdout).toContain('apps/portal/src/modules.ts');
  });

  test('uses packages/module-<id> in a workspace that only has packages/', async () => {
    await mkdir(join(workspace.root(), 'packages'));
    await runNew('module', 'mail-store', '--scope', '@acme');
    expect(await listing(join(workspace.root(), 'packages', 'module-mail-store'))).toContain(
      'package.json',
    );
  });

  test('keelwerk module new is the alias', async () => {
    const run = await runCliWith(
      ['module', 'new', 'mail-store', '--scope', '@acme'],
      createFakeHost({ cwd: workspace.root() }).host,
    );
    expect(run.code).toBe(0);
    expect(await listing(join(workspace.root(), 'modules', 'mail-store'))).toContain('src/base.ts');
  });

  test('--dry-run lists the files and writes none', async () => {
    const run = await runNew('module', 'mail-store', '--scope', '@acme', '--dry-run');
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('would create modules/mail-store/src/base.ts');
    expect(await readdir(workspace.root())).toEqual([]);
  });

  test('the package declares vitest and, outside the framework workspace, pins core', async () => {
    await runNew('module', 'mail-store', '--scope', '@acme');
    const json = JSON.parse(await read('modules/mail-store/package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(json.devDependencies).toHaveProperty('vitest');
    expect(json.dependencies['@keelwerk/core']).toMatch(/^\d+\.\d+\.\d+/);
    expect(await read('modules/mail-store/vitest.config.ts')).toContain(
      "name: 'module-mail-store'",
    );
  });

  test('inside the framework workspace core is a workspace dependency', async () => {
    await mkdir(join(workspace.root(), 'packages', 'core'), { recursive: true });
    await writeFile(join(workspace.root(), 'packages', 'core', 'package.json'), '{}');
    await runNew('module', 'mail-store', '--scope', '@acme');
    const json = JSON.parse(await read('packages/module-mail-store/package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(json.dependencies['@keelwerk/core']).toBe('workspace:*');
  });

  test('an unscoped root name is never turned into a scope', async () => {
    await writeFile(join(workspace.root(), 'package.json'), '{ "name": "keelwerk-workspace" }');
    const run = await runNew('module', 'mail-store', '--requires', 'accounts', '--dry-run');
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--scope');
  });

  test('the scope comes from the first scoped sibling package', async () => {
    await mkdir(join(workspace.root(), 'packages', 'module-accounts'), { recursive: true });
    await writeFile(
      join(workspace.root(), 'packages', 'module-accounts', 'package.json'),
      '{ "name": "@acme/module-accounts" }',
    );
    await writeFile(join(workspace.root(), 'package.json'), '{ "name": "keelwerk-workspace" }');
    const run = await runNew('module', 'mail-store', '--requires', 'accounts');
    expect(run.code).toBe(0);
    expect(await read('packages/module-mail-store/src/base.ts')).toContain(
      "from '@acme/module-accounts'",
    );
  });

  test.each([
    [['--requires', "Bad'Id"], '--requires'],
    [['--optional', 'a,B'], '--optional'],
    [['--app', '../x'], '--app'],
    [['--scope', 'acme'], '--scope'],
    [['--scope', "@a'b"], '--scope'],
  ])('%j is refused with a usage failure', async (flags, name) => {
    const run = await runNew('module', 'mail-store', '--scope', '@acme', ...flags);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(name);
    expect(await readdir(workspace.root())).toEqual([]);
  });

  test('a transport module has no scaffold', async () => {
    const run = await runNew('module', 'mail-http', '--kind', 'transport');
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('domain module only');
  });
});

describe('new module inside the framework repository', () => {
  const repository = fileURLToPath(new URL('../../..', import.meta.url));
  const id = 'scaffold-probe';
  const created = join(repository, 'packages', `module-${id}`);
  const bin = (name: string): string => join(repository, 'node_modules', '.bin', name);

  afterEach(async () => {
    await rm(created, { recursive: true, force: true });
  });

  test('the generated type test and alone test compile and pass', async () => {
    const run = await runCliWith(
      ['new', 'module', id, '--scope', '@keelwerk'],
      createFakeHost({ cwd: repository }).host,
    );
    expect(run.code).toBe(0);
    const modules = join(created, 'node_modules');
    await mkdir(join(modules, '@keelwerk'), { recursive: true });
    await symlink(join(repository, 'packages', 'core'), join(modules, '@keelwerk', 'core'));
    await symlink(join(repository, 'packages', 'testing'), join(modules, '@keelwerk', 'testing'));
    await symlink(
      join(repository, 'packages', 'testing', 'node_modules', 'vitest'),
      join(modules, 'vitest'),
    );
    const compiled = await execFileAsync(bin('tsc'), ['-b', join(created, 'tsconfig.test.json')], {
      cwd: repository,
    }).catch((error: { stdout?: string }) => error);
    expect(compiled).not.toHaveProperty('code');
    const tested = await execFileAsync(
      bin('vitest'),
      ['run', '--root', created, '--config', join(created, 'vitest.config.ts')],
      { cwd: created },
    ).catch((error: { stdout?: string; stderr?: string }) => error);
    expect(tested).not.toHaveProperty('code');
    expect(String((tested as { stdout?: string }).stdout)).toMatch(/Tests\s+2 passed/);
  }, 300_000);
});
