import type { PinCopy } from './pin-copy.ts';

const rootPackageJson = 'packages/cli/src/init/templates/root-package-json.ts';
const composeYaml = 'packages/cli/src/init/templates/compose-yaml.ts';
const portalCompose = 'examples/portal/.launchway/compose.yaml';
const knipSchema = /unpkg\.com\/knip@([^/]+)\/schema\.json/dg;
const pnpmInstall = /npm install -g pnpm@(\S+) /dg;
const nodeImage = /image: (node:\S+)/dg;
const pnpmText = /pnpm[ @](\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)/dg;

/** Every hand-written copy of a version, with the source it follows; the Biome peer row only guards a place Dependabot also moves. */
export const pinCopies: readonly PinCopy[] = [
  { file: rootPackageJson, source: 'biome', pattern: /'@biomejs\/biome': '([^']+)'/dg, count: 1 },
  { file: rootPackageJson, source: 'typesNode', pattern: /'@types\/node': '([^']+)'/dg, count: 1 },
  { file: rootPackageJson, source: 'knip', pattern: /\bknip: '([^']+)'/dg, count: 1 },
  { file: rootPackageJson, source: 'typescript', pattern: /\btypescript: '([^']+)'/dg, count: 1 },
  { file: rootPackageJson, source: 'vitest', pattern: /\bvitest: '([^']+)'/dg, count: 1 },
  {
    file: 'packages/cli/src/scaffold/module-template.ts',
    source: 'vitest',
    pattern: /\bvitest: '([^']+)'/dg,
    count: 1,
  },
  {
    file: 'packages/cli/src/init/templates/knip-json.ts',
    source: 'knip',
    pattern: knipSchema,
    count: 1,
  },
  { file: 'knip.json', source: 'knip', pattern: knipSchema, count: 1 },
  {
    file: 'packages/biome-config/package.json',
    source: 'biome',
    pattern: /"peerDependencies": \{\s*"@biomejs\/biome": "([^"]+)"/dg,
    count: 1,
  },
  {
    file: 'packages/biome-config/preset.jsonc',
    source: 'biome',
    pattern: /biomejs\.dev\/schemas\/([^/]+)\/schema\.json/dg,
    count: 1,
  },
  { file: composeYaml, source: 'pnpm', pattern: pnpmInstall, count: 1 },
  { file: composeYaml, source: 'nodeImage', pattern: nodeImage, count: 1 },
  { file: portalCompose, source: 'pnpm', pattern: pnpmInstall, count: 1 },
  { file: portalCompose, source: 'nodeImage', pattern: nodeImage, count: 1 },
  { file: 'README.md', source: 'pnpm', pattern: pnpmText, count: 2 },
  { file: 'CONTRIBUTING.md', source: 'pnpm', pattern: pnpmText, count: 2 },
  {
    file: '.github/workflows/release-please.yml',
    source: 'npm',
    pattern: /npm install -g npm@(\S+)/dg,
    count: 1,
  },
  {
    file: 'packages/testing/src/postgres/postgres-image.ts',
    source: 'postgresImage',
    pattern: /postgresImage = '([^']+)'/dg,
    count: 1,
  },
];
