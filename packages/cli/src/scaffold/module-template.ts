import { camelFromKebab, pascal, version } from '@keelwerk/core';
import { renderModuleManifest } from '@keelwerk/core/manifest';
import { usageFailure } from '../context/usage-failure.ts';
import { expectNames } from './expect-names.ts';
import { jsonText } from './json-text.ts';
import { moduleImport } from './module-import.ts';
import { packageDirectory } from './package-directory.ts';
import { renderImports } from './render-imports.ts';
import { requireScope } from './require-scope.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

const ENTRY = 'module.generated';

function references(request: ScaffoldRequest, ids: readonly string[]): { path: string }[] {
  return [
    ...(request.coreSibling ? [{ path: '../core' }] : []),
    ...ids.map((id) => ({ path: `../${packageDirectory(id, request.packagesLayout)}` })),
  ];
}

/**
 * `keelwerk new module <id> [--kind domain] [--requires a,b] [--optional c] [--app <id>]`: the
 * package of section 16.9.8, with the generator run once for `module.generated.ts`.
 */
export function moduleTemplate(request: ScaffoldRequest): ScaffoldPlan {
  expectNames('module', request.names, [0], '<id>');
  const { requires, optional, app } = request.options;
  if ((request.options.kind ?? 'domain') !== 'domain') {
    throw usageFailure(
      `--kind ${request.options.kind ?? ''} has no scaffold: section 16.9.8 gives the layout of a domain module only.`,
    );
  }
  const scope = requireScope(request);
  const id = request.target;
  const name = camelFromKebab(id);
  const type = pascal(id);
  const root = request.root;
  const packageName = `${scope}/module-${id}`;
  const dependencies = [...requires, ...optional];
  const baseImports = renderImports([
    { from: '@keelwerk/core', names: ['defineModuleBase', 'type ModuleBaseType'] },
    ...dependencies.map((other) => moduleImport(scope, other)),
  ]);
  const list = (ids: readonly string[]): string[] =>
    ids.length === 0
      ? []
      : [
          `  ${ids === requires ? 'requires' : 'optional'}: [${ids.map(camelFromKebab).join(', ')}],`,
        ];
  const base = `${baseImports}

const ${name}BaseDef = defineModuleBase({
  id: '${id}',
  version: '0.1.0',
${[...list(requires), ...list(optional)].join('\n')}${requires.length + optional.length > 0 ? '\n' : ''}});

export interface ${type}Base extends ModuleBaseType<typeof ${name}BaseDef> {}
export const ${name}Base: ${type}Base = ${name}BaseDef;
`;
  const manifest = renderModuleManifest({
    id,
    generatorVersion: version,
    scanned: { parts: [], unplaced: [] },
    migrations: false,
  });
  const apps = (extra: readonly string[]): string =>
    [`${name}`, ...extra.map(camelFromKebab)].join(', ');
  const typeTestImports = renderImports([
    { from: '@keelwerk/core', names: ['defineApp', 'type Registry'] },
    { from: 'vitest', names: ['describe', 'expectTypeOf', 'test'] },
    ...dependencies.map((other) => moduleImport(scope, other)),
    { from: `./${ENTRY}.ts`, names: [name] },
  ]);
  const cases: { title: string; id: string; modules: readonly string[] }[] = [
    { title: 'alone', id: 'alone', modules: requires },
    ...optional.map((other) => ({
      title: `with ${other}`,
      id: `with-${other}`,
      modules: [...requires, other],
    })),
  ];
  const typeTest = `${typeTestImports}

describe('${id} composes', () => {
${cases
  .map(
    (entry) => `  test('${entry.title}', () => {
    const app = defineApp({ id: '${entry.id}', modules: [${apps(entry.modules)}] as const });
    expectTypeOf(app.registry).toEqualTypeOf<Registry>();
  });`,
  )
  .join('\n\n')}
});
`;
  const aloneTest = `${renderImports([
    { from: 'vitest', names: ['expect', 'test'] },
    { from: '@keelwerk/core', names: ['defineApp'] },
    ...requires.map((other) => moduleImport(scope, other)),
    { from: `../src/${ENTRY}.ts`, names: [name] },
  ])}

test('${id} composes into an app without problems', () => {
  const app = defineApp({ id: 'alone', modules: [${apps(requires)}] as const });
  expect(app.registry.problems.filter((problem) => problem.severity === 'error')).toEqual([]);
});
`;
  const entry = {
    '@keelwerk/source': `./src/${ENTRY}.ts`,
    types: `./dist/src/${ENTRY}.d.ts`,
    default: `./dist/src/${ENTRY}.js`,
  };
  const packageJson = {
    name: packageName,
    version: '0.0.0',
    type: 'module',
    exports: { '.': entry },
    publishConfig: {
      exports: { '.': { types: entry.types, default: entry.default } },
    },
    files: ['dist'],
    dependencies: {
      '@keelwerk/core': request.coreSibling ? 'workspace:*' : version,
      ...Object.fromEntries(
        dependencies.map((other) => [`${scope}/module-${other}`, 'workspace:*']),
      ),
    },
    devDependencies: { vitest: '5.0.5' },
  };
  const vitestConfig = `import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['@keelwerk/source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    name: 'module-${id}',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/**/*.postgres.test.ts'],
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts', 'test/**/*.test-d.ts'],
      tsconfig: 'tsconfig.test.json',
    },
  },
});
`;
  const compilerBase = {
    extends: '../../tsconfig.base.json',
    compilerOptions: { rootDir: '.', outDir: 'dist' },
  };
  const tsconfig = {
    ...compilerBase,
    include: ['src', 'migrations'],
    exclude: ['src/**/*.test.ts', 'src/**/*.test-d.ts'],
    references: references(request, dependencies),
  };
  const tsconfigTest = {
    extends: compilerBase.extends,
    compilerOptions: {
      ...compilerBase.compilerOptions,
      composite: false,
      declaration: false,
      declarationMap: false,
      sourceMap: false,
      noEmit: true,
      rewriteRelativeImportExtensions: false,
      allowImportingTsExtensions: true,
    },
    include: ['src', 'migrations', 'test'],
    references: [{ path: './tsconfig.json' }, ...references(request, dependencies)],
  };
  const directory = packageDirectory(id, request.packagesLayout);
  const location = `${request.packagesLayout ? 'packages' : 'modules'}/${directory}`;
  return {
    files: [
      { path: `${root}/package.json`, text: jsonText(packageJson) },
      { path: `${root}/tsconfig.json`, text: jsonText(tsconfig) },
      { path: `${root}/tsconfig.test.json`, text: jsonText(tsconfigTest) },
      { path: `${root}/vitest.config.ts`, text: vitestConfig },
      { path: `${root}/src/base.ts`, text: base },
      { path: `${root}/src/${ENTRY}.ts`, text: manifest },
      { path: `${root}/src/module.test-d.ts`, text: typeTest },
      { path: `${root}/test/alone.test.ts`, text: aloneTest },
    ],
    handEdits: [
      {
        file: 'tsconfig.json',
        reason: 'the root configuration references the new package',
        lines: [`{ "path": "${location}" },`, `{ "path": "${location}/tsconfig.test.json" },`],
      },
      ...(app === undefined
        ? []
        : [
            {
              file: `apps/${app}/src/modules.ts`,
              reason: `the app selects the module (add ${packageName} to the app's dependencies)`,
              lines: [
                `import { ${name} } from '${packageName}';`,
                `export const modules = [..., ${name}] as const;`,
              ],
            },
          ]),
    ],
  };
}
