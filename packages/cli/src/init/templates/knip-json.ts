import type { InitNames } from '../init-names.ts';

/** `knip.json`: unused files are forgotten mounts, so every package is a workspace with its type tests as entries. */
export function knipJson(names: InitNames): unknown {
  const entry = {
    entry: ['src/**/*.test-d.ts'],
    project: ['src/**/*.ts'],
  };
  return {
    $schema: 'https://unpkg.com/knip@6.42.1/schema.json',
    ignore: ['**/generated/**'],
    workspaces: {
      '.': {
        entry: ['.launchway/deployment.ts', '.launchway/launchway.ts'],
        ignoreDependencies: [
          '@keelwerk/adapter-postgres',
          '@keelwerk/biome-config',
          '@keelwerk/cli',
          '@keelwerk/core',
          '@keelwerk/data',
          '@keelwerk/transport-http',
        ],
      },
      [`apps/${names.app}`]: {
        ...entry,
        entry: [...entry.entry, 'src/keelwerk.generated.ts'],
        ignoreDependencies: ['@keelwerk/core'],
      },
      [`modules/${names.module}`]: {
        ...entry,
        ignoreDependencies: ['@keelwerk/core', '@keelwerk/testing'],
      },
    },
  };
}
