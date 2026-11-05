import { version } from '@keelwerk/core';
import type { InitNames } from '../init-names.ts';

/** The root `package.json`: the workspace's scripts and the tools every package shares. */
export function rootPackageJson(names: InitNames): unknown {
  return {
    name: `${names.scope}/${names.project}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'keelwerk dev',
      build: 'keelwerk build',
      generate: 'keelwerk generate',
      check: 'biome ci . && knip && tsc -b && vitest run && keelwerk generate --check',
    },
    dependencies: {
      '@keelwerk/adapter-postgres': version,
      '@keelwerk/core': version,
      '@keelwerk/data': version,
      '@keelwerk/transport-http': version,
    },
    devDependencies: {
      '@biomejs/biome': '2.5.15',
      '@keelwerk/biome-config': version,
      '@keelwerk/cli': version,
      '@types/node': '26.6.5',
      knip: '6.42.1',
      typescript: '7.0.2',
      vitest: '5.0.5',
    },
  };
}
