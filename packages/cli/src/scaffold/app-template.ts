import { camelFromKebab, pascal, version } from '@keelwerk/core';
import { expectNames } from './expect-names.ts';
import { jsonText } from './json-text.ts';
import { moduleImport } from './module-import.ts';
import { packageDirectory } from './package-directory.ts';
import { renderImports } from './render-imports.ts';
import { requireScope } from './require-scope.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

/**
 * `keelwerk new app <id> [--modules a,b]`: `apps/<id>/` with the selection (`src/modules.ts`),
 * the app (`src/app.ts`) and a type test (section 23.1). The generated `keelwerk.generated.ts` and
 * `generated/` come from `keelwerk generate`.
 */
export function appTemplate(request: ScaffoldRequest): ScaffoldPlan {
  const scope = requireScope(request);
  expectNames('app', request.names, [0], '<id>');
  const id = request.target;
  const name = camelFromKebab(id);
  const type = pascal(id);
  const root = request.root;
  const { modules } = request.options;
  const modulesText = `${renderImports(modules.map((other) => moduleImport(scope, other)))}${modules.length > 0 ? '\n\n' : ''}export const modules = [${modules.map(camelFromKebab).join(', ')}] as const;
`;
  const appText = `${renderImports([
    { from: '@keelwerk/core', names: ['type AppType', 'defineApp'] },
    { from: './modules.ts', names: ['modules'] },
  ])}

const ${name}Def = defineApp({ id: '${id}', modules });

export interface ${type} extends AppType<typeof ${name}Def> {}
export const ${name}: ${type} = ${name}Def;
`;
  const typeTest = `${renderImports([
    { from: '@keelwerk/core', names: ['type Registry'] },
    { from: 'vitest', names: ['describe', 'expectTypeOf', 'test'] },
    { from: './app.ts', names: [`type ${type}`] },
  ])}

describe('the ${id} app', () => {
  test('carries the composed registry', () => {
    expectTypeOf<${type}['registry']>().toEqualTypeOf<Registry>();
  });
});
`;
  const references = [
    ...(request.coreSibling ? [{ path: '../../packages/core' }] : []),
    ...modules.map((other) => ({
      path: `../../${request.packagesLayout ? 'packages' : 'modules'}/${packageDirectory(other, request.packagesLayout)}`,
    })),
  ];
  const packageJson = {
    name: `${scope}/app-${id}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: {
      '@keelwerk/core': request.coreSibling ? 'workspace:*' : version,
      ...Object.fromEntries(modules.map((other) => [`${scope}/module-${other}`, 'workspace:*'])),
    },
  };
  const compiler = { rootDir: '.', outDir: 'dist' };
  return {
    files: [
      { path: `${root}/package.json`, text: jsonText(packageJson) },
      {
        path: `${root}/tsconfig.json`,
        text: jsonText({
          extends: '../../tsconfig.base.json',
          compilerOptions: compiler,
          include: ['src'],
          exclude: ['src/**/*.test.ts', 'src/**/*.test-d.ts'],
          references,
        }),
      },
      {
        path: `${root}/tsconfig.test.json`,
        text: jsonText({
          extends: '../../tsconfig.base.json',
          compilerOptions: {
            ...compiler,
            composite: false,
            declaration: false,
            declarationMap: false,
            sourceMap: false,
            noEmit: true,
            rewriteRelativeImportExtensions: false,
            allowImportingTsExtensions: true,
          },
          include: ['src', 'test'],
          references: [{ path: './tsconfig.json' }, ...references],
        }),
      },
      { path: `${root}/src/modules.ts`, text: modulesText },
      { path: `${root}/src/app.ts`, text: appText },
      { path: `${root}/src/app.test-d.ts`, text: typeTest },
    ],
    handEdits: [
      {
        file: 'tsconfig.json',
        reason: 'the root configuration references the new package',
        lines: [`{ "path": "${root}" },`, `{ "path": "${root}/tsconfig.test.json" },`],
      },
    ],
  };
}
