import type { InitNames } from '../init-names.ts';

/** `.launchway/tsconfig.json`: type-checks the deployment file, which imports the app and which no other project includes. */
export function launchwayTsconfig(names: InitNames): unknown {
  return {
    extends: '../tsconfig.base.json',
    compilerOptions: {
      composite: false,
      declaration: false,
      declarationMap: false,
      sourceMap: false,
      noEmit: true,
      rewriteRelativeImportExtensions: false,
      allowImportingTsExtensions: true,
    },
    include: ['deployment.ts', 'launchway.ts'],
    references: [{ path: `../apps/${names.app}` }],
  };
}
