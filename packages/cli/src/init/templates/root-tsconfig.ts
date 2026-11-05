import type { InitNames } from '../init-names.ts';

/** The root `tsconfig.json`: no files of its own, a reference to every package, its test configuration and the deployment file. */
export function rootTsconfig(names: InitNames): unknown {
  const packages = [`modules/${names.module}`, `apps/${names.app}`];
  return {
    files: [],
    references: [
      ...packages.flatMap((path) => [{ path }, { path: `${path}/tsconfig.test.json` }]),
      { path: '.launchway' },
    ],
  };
}
