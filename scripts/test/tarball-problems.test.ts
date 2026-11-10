import { expect, test } from 'vitest';
import { tarballProblems } from '../tarball-problems.ts';

const expected = { name: '@keelwerk/core', version: '0.1.0', directory: 'core' };
const files = ['package.json', 'dist/index.js', 'dist/index.d.ts', 'dist/bin.js'];
const good = {
  name: '@keelwerk/core',
  version: '0.1.0',
  license: 'FSL-1.1-ALv2',
  engines: { node: '>=26' },
  repository: {
    type: 'git',
    url: 'git+https://github.com/JensPenneman/keelwerk.git',
    directory: 'packages/core',
  },
  exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
  bin: { keel: './dist/bin.js' },
  dependencies: { '@keelwerk/data': '0.1.0' },
};

test('a well-formed manifest with its files has no problem', () => {
  expect(tarballProblems(good, files, expected)).toEqual([]);
});

test.each([
  ['name', { name: '@keelwerk/other' }, 'name is @keelwerk/other'],
  ['version', { version: '0.2.0' }, 'version is 0.2.0, expected 0.1.0'],
  ['engines', { engines: { node: '>=24' } }, 'engines.node is not >=26'],
  ['licence', { license: ' ' }, 'license is missing'],
  [
    'repository url',
    { repository: { ...good.repository, url: 'git+https://github.com/x/y.git' } },
    'repository.url is not git+https://github.com/JensPenneman/keelwerk.git',
  ],
  [
    'repository directory',
    { repository: { ...good.repository, directory: 'packages/data' } },
    'repository.directory is not packages/core',
  ],
  [
    'workspace spec',
    { dependencies: { '@keelwerk/data': 'workspace:*' } },
    'dependencies @keelwerk/data is still workspace:*',
  ],
  [
    'source condition',
    { exports: { '.': { '@keelwerk/source': './src/index.ts', default: './dist/index.js' } } },
    'exports still has the @keelwerk/source condition',
  ],
  [
    'exports target',
    { exports: { '.': { default: './dist/missing.js' } } },
    'exports target ./dist/missing.js is not in the tarball',
  ],
  [
    'bin target',
    { bin: { keel: './dist/none.js' } },
    'bin target ./dist/none.js is not in the tarball',
  ],
])('a wrong %s is one problem', (_what, change, text) => {
  expect(tarballProblems({ ...good, ...change }, files, expected)).toEqual([
    `@keelwerk/core: ${text}`,
  ]);
});

test('wildcard exports are not looked up', () => {
  const manifest = { ...good, exports: { './*': './presets/*.jsonc' } };
  expect(tarballProblems(manifest, files, expected)).toEqual([]);
});
