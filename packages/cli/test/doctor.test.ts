import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { checkArtefacts } from '../src/doctor/check-artefacts.ts';
import { checkDeclarationSizes } from '../src/doctor/check-declaration-sizes.ts';
import { checkEnvironment } from '../src/doctor/check-environment.ts';
import { checkNamedTypes } from '../src/doctor/check-named-types.ts';
import { checkPackageManifests } from '../src/doctor/check-package-manifests.ts';
import { checkReferences } from '../src/doctor/check-references.ts';
import { checkTsconfigs } from '../src/doctor/check-tsconfigs.ts';
import { readEnvironmentFacts } from '../src/doctor/read-environment-facts.ts';
import { runDoctor } from '../src/doctor/run-doctor.ts';
import { loadWorkspace } from '../src/layout/load-workspace.ts';
import clean from './layout-fixtures/clean.json' with { type: 'json' };
import { materialise, removeTrees, writeManifests } from './layout-fixtures/materialise-tree.ts';
import { createFakeHost } from './support/fake-host.ts';
import { runCliWith } from './support/run-cli-with.ts';

const goodEnvironment = {
  node: '26.13.0',
  typescript: '7.0.2',
  typescriptSix: '6.0.3',
  pnpm: '11.21.0',
  pnpmWanted: '11.21.0',
  biome: '2.6.3',
  biomeWanted: '2.6.3',
};

afterEach(async () => {
  await removeTrees();
});

async function workspace(
  edit: Readonly<Record<string, string | null>> = {},
): Promise<Awaited<ReturnType<typeof loadWorkspace>> & { dir: string }> {
  const dir = await materialise(clean.files);
  await writeManifests(dir);
  for (const [path, text] of Object.entries(edit)) {
    if (text === null) await rm(join(dir, path));
    else {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), text);
    }
  }
  return { ...(await loadWorkspace(dir)), dir };
}

function json(path: string, change: (value: Record<string, unknown>) => void): string {
  const value = JSON.parse(clean.files[path as keyof typeof clean.files]) as Record<
    string,
    unknown
  >;
  change(value);
  return JSON.stringify(value);
}

describe('the environment', () => {
  test('a good environment has no finding', () => {
    expect(checkEnvironment(goodEnvironment)).toEqual([]);
  });

  test('Node older than 26 is an error; other versions warn', () => {
    const found = checkEnvironment({
      ...goodEnvironment,
      node: '24.21.0',
      typescript: '6.0.3',
      pnpm: '10.0.0',
      biome: '2.5.0',
    });
    expect(found.map((finding) => [finding.subject, finding.severity])).toEqual([
      ['node', 'error'],
      ['typescript', 'warning'],
      ['pnpm', 'warning'],
      ['biome', 'warning'],
    ]);
  });

  test('the facts come from the root manifest and the installed packages', async () => {
    const dir = await materialise({
      'package.json': JSON.stringify({
        packageManager: 'pnpm@11.21.0',
        devDependencies: { '@biomejs/biome': '2.6.3' },
      }),
      'node_modules/typescript/package.json': '{"version":"7.0.2"}',
      'node_modules/@biomejs/biome/package.json': '{"version":"2.6.3"}',
      'node_modules/@keelwerk/biome-config/package.json':
        '{"peerDependencies":{"@biomejs/biome":"2.6.3"}}',
    });
    expect(await readEnvironmentFacts(dir, 'v26.13.0', async () => '11.21.0')).toEqual(
      goodEnvironment,
    );
  });
});

describe('the project', () => {
  test('a workspace in the conventions passes every project check', async () => {
    const space = await workspace();
    expect(await checkTsconfigs(space)).toEqual([]);
    expect(checkReferences(space)).toEqual([]);
    expect(checkPackageManifests(space)).toEqual([]);
    expect(checkNamedTypes(space)).toEqual([]);
  });

  test('tsconfigs: a missing rootDir, the source condition and isolatedDeclarations in a module package', async () => {
    const space = await workspace({
      'packages/module-shop/tsconfig.json': json('packages/module-shop/tsconfig.json', (value) => {
        value.compilerOptions = { outDir: 'dist', isolatedDeclarations: true };
      }),
      'tsconfig.base.json': json('tsconfig.base.json', (value) => {
        (value.compilerOptions as Record<string, unknown>).strict = false;
      }),
    });
    const found = await checkTsconfigs(space);
    const messages = found.map((finding) => `${finding.subject}: ${finding.message}`);
    expect(messages).toContainEqual(expect.stringContaining('tsconfig.base.json: strict is false'));
    expect(messages).toContainEqual(
      expect.stringContaining('packages/module-shop/tsconfig.json: rootDir is not set'),
    );
    expect(messages).toContainEqual(
      expect.stringContaining('isolatedDeclarations is on in a package that exports DSL values'),
    );
    expect(found.every((finding) => finding.fix !== '')).toBe(true);
  });

  test('tsconfigs: a package that extends the base and overrides its strict options, or does not extend it', async () => {
    const space = await workspace({
      'packages/module-shop/tsconfig.json': json('packages/module-shop/tsconfig.json', (value) => {
        value.compilerOptions = {
          rootDir: '.',
          outDir: 'dist',
          strict: false,
          noUncheckedIndexedAccess: false,
          exactOptionalPropertyTypes: false,
        };
      }),
      'packages/module-accounts/tsconfig.json': json(
        'packages/module-accounts/tsconfig.json',
        (value) => {
          value.extends = undefined;
          value.compilerOptions = {
            rootDir: '.',
            outDir: 'dist',
            customConditions: ['@keelwerk/source'],
          };
        },
      ),
    });
    const messages = (await checkTsconfigs(space)).map(
      (finding) => `${finding.subject}: ${finding.message}`,
    );
    expect(messages).toContainEqual(
      expect.stringContaining('packages/module-shop/tsconfig.json: strict is false'),
    );
    expect(messages).toContainEqual(
      expect.stringContaining(
        'packages/module-shop/tsconfig.json: noUncheckedIndexedAccess is false',
      ),
    );
    expect(messages).toContainEqual(
      expect.stringContaining(
        'packages/module-shop/tsconfig.json: exactOptionalPropertyTypes is false',
      ),
    );
    expect(messages).toContainEqual(
      'packages/module-accounts/tsconfig.json: the configuration does not extend tsconfig.base.json',
    );
  });

  test('references: a workspace dependency that tsconfig.json does not reference', async () => {
    const space = await workspace({
      'packages/module-shop/tsconfig.json': json('packages/module-shop/tsconfig.json', (value) => {
        value.references = [];
      }),
    });
    expect(checkReferences(space).map((finding) => finding.message)).toEqual([
      '@acme/module-accounts is a workspace dependency but is not referenced',
    ]);
  });

  test('manifests: the source condition belongs in exports and not in publishConfig.exports', async () => {
    const space = await workspace({
      'packages/module-shop/package.json': json('packages/module-shop/package.json', (value) => {
        value.exports = { '.': { types: './dist/x.d.ts', default: './dist/x.js' } };
        value.publishConfig = { exports: { '.': { '@keelwerk/source': './src/x.ts' } } };
      }),
    });
    expect(checkPackageManifests(space).map((finding) => finding.message)).toEqual([
      'exports "." has no @keelwerk/source condition',
      'publishConfig.exports carries the @keelwerk/source condition, which Node refuses under node_modules',
    ]);
  });

  test('artefacts: a failing --check names the drift and its fix', async () => {
    const found = await checkArtefacts('/project', async () => ({
      code: 1,
      output: 'library: 2026-11-04.json has drifted',
    }));
    expect(found).toEqual([
      expect.objectContaining({
        subject: 'keelwerk generate --check',
        message: 'library: 2026-11-04.json has drifted',
        fix: 'run keelwerk generate',
      }),
    ]);
    expect(await checkArtefacts('/project', async () => ({ code: 0, output: '' }))).toEqual([]);
  });

  test('named types: a base, a module and an entity without one', async () => {
    const space = await workspace({
      'packages/module-shop/src/entities/order.ts':
        "import { defineEntity, field } from '@keelwerk/core';\n\nexport const order = defineEntity({ prefix: 'ord', fields: { total: field.integer() } });\n",
      'packages/module-shop/src/base.ts':
        "import { defineModuleBase } from '@keelwerk/core';\nimport { order } from './entities/order.ts';\nimport { toAccounts } from './contributions/to-accounts/contribution.ts';\n\nexport const shopBase = defineModuleBase({ id: 'shop', entities: { order }, contributions: { toAccounts } });\n",
    });
    expect(checkNamedTypes(space).map((finding) => [finding.severity, finding.message])).toEqual([
      ['error', 'shopBase is the value of defineModuleBase and has no named type'],
      ['warning', 'order has no named type'],
    ]);
  });

  test('declaration sizes: over the manifest and package budgets, exempt prefixes skipped', async () => {
    const space = await workspace({
      'scripts/type-budgets/budgets.json': JSON.stringify({
        declarations: {
          manifestBytes: 100,
          packageBytes: 300,
          exempt: ['packages/module-accounts'],
        },
      }),
      'packages/module-shop/dist/src/module.generated.d.ts': 'x'.repeat(150),
      'packages/module-shop/dist/src/base.d.ts': 'y'.repeat(200),
      'packages/module-accounts/dist/src/module.generated.d.ts': 'z'.repeat(5000),
    });
    expect(
      (await checkDeclarationSizes(space)).map((finding) => [finding.subject, finding.message]),
    ).toEqual([
      ['packages/module-shop', 'module.generated.d.ts is 150 bytes, the budget is 100'],
      ['packages/module-shop', 'the declarations are 350 bytes, the budget is 300'],
    ]);
  });

  test('runDoctor over a workspace in the conventions finds nothing; --layout runs the layout pass alone', async () => {
    const space = await workspace();
    const run = {
      root: space.dir,
      environment: goodEnvironment,
      runArtefacts: async () => ({ code: 0, output: '' }),
      deployment: undefined,
      now: Temporal.Instant.from('2026-11-05T10:00:00Z'),
    };
    expect(
      (await runDoctor({ ...run, layoutOnly: false })).map((finding) => [
        finding.check,
        finding.severity,
      ]),
    ).toEqual([]);
    expect(await runDoctor({ ...run, layoutOnly: true })).toEqual([]);
    const drifted = await workspace({
      'packages/module-shop/src/helpers/x.ts': 'export const x = 1;\n',
    });
    const layout = await runDoctor({ ...run, root: drifted.dir, layoutOnly: true });
    expect(layout.map((finding) => finding.check)).toEqual(['layout/placement']);
  });
});

describe('the doctor command', () => {
  async function run(argv: readonly string[], edit: Readonly<Record<string, string>> = {}) {
    const space = await workspace(edit);
    const host = createFakeHost({
      cwd: space.dir,
      files: { [`${space.dir}/pnpm-workspace.yaml`]: 'packages:\n  - packages/*\n' },
    });
    return runCliWith(argv, host.host);
  }

  test('--layout on a workspace in the conventions prints no finding and exits 0', async () => {
    const result = await run(['doctor', '--layout', '--output', 'text']);
    expect(result.stdout.trim()).toBe('layout: no findings');
    expect(result.code).toBe(0);
  });

  test('--layout names each finding with its fix and exits 1', async () => {
    const result = await run(['doctor', '--layout', '--output', 'text'], {
      'packages/module-shop/src/helpers/x.ts': 'export const x = 1;\n',
    });
    expect(result.stdout).toContain(
      'error [layout/placement] packages/module-shop/src/helpers/x.ts',
    );
    expect(result.stdout).toContain('  fix: move the file into a directory of the module layout');
    expect(result.stdout).toContain('1 error(s), 0 warning(s), 0 note(s)');
    expect(result.code).toBe(1);
  });

  test('--output json prints the findings as data', { timeout: 60_000 }, async () => {
    const result = await run(['doctor', '--layout', '--output', 'json'], {
      'packages/module-shop/src/helpers/x.ts': 'export const x = 1;\n',
    });
    const findings = JSON.parse(result.stdout) as { check: string; fix: string }[];
    expect(findings.map((finding) => finding.check)).toEqual(['layout/placement']);
  });
});
