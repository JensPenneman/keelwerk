/** A sample file at a path that decides the result, and what the lint says of it. */
type ImportRuleCase = readonly [
  name: string,
  path: string,
  source: string,
  /** The message of the refusal, or `allowed` when no import rule refuses the file. */
  verdict: string,
];

const driver = 'Handlers reach data through ctx.load and ctx.write.';
const network = 'Network access belongs in src/executors/.';
const modules = 'Module packages do not import adapters, transports or the data package.';
const transports = 'Transports import only the core: they see the surface and the invoker.';
const core = 'The core imports nothing from the workspace.';
const use = (module: string): string =>
  `import * as used from '${module}';\nexport const x = used;\n`;

const place = 'packages/testing/src/postgres';

export const container =
  'Start a PostgreSQL test container with startPostgres of @keelwerk/testing/postgres: its stop applies the deadlock rule.';

/** The four import rules of the preset: one case per family, then the cases that must pass. */
export const presetCases: readonly ImportRuleCase[] = [
  ['module source, database driver', 'packages/module-x/src/driver.ts', use('pg'), driver],
  ['module source, query builder', 'packages/module-x/src/builder.ts', use('kysely'), driver],
  [
    'module source, type-only import of a driver',
    'packages/module-x/src/type-only.ts',
    "import type { Pool } from 'pg';\nexport type P = Pool;\n",
    driver,
  ],
  [
    'module source, adapter',
    'packages/module-x/src/adapter.ts',
    use('@keelwerk/adapter-postgres'),
    modules,
  ],
  [
    'module source, transport',
    'packages/module-x/src/transport.ts',
    use('@keelwerk/transport-http'),
    modules,
  ],
  ['module source, data package', 'packages/module-x/src/data.ts', use('@keelwerk/data'), modules],
  ['module source, network client', 'packages/module-x/src/client.ts', use('undici'), network],
  [
    'module executors, network client',
    'packages/module-x/src/executors/client.ts',
    use('undici'),
    'allowed',
  ],
  [
    'module executors, database driver',
    'packages/module-x/src/executors/driver.ts',
    use('pg'),
    driver,
  ],
  ['module source, core', 'packages/module-x/src/core.ts', use('@keelwerk/core'), 'allowed'],
  [
    'transport source, module package',
    'packages/transport-x/src/module.ts',
    use('@keelwerk/module-auth'),
    transports,
  ],
  [
    'transport source, adapter',
    'packages/transport-x/src/adapter.ts',
    use('@keelwerk/adapter-postgres'),
    transports,
  ],
  [
    'transport source, data package',
    'packages/transport-x/src/data.ts',
    use('@keelwerk/data'),
    transports,
  ],
  ['transport source, core', 'packages/transport-x/src/core.ts', use('@keelwerk/core'), 'allowed'],
  ['core source, workspace package', 'packages/core/src/workspace.ts', use('@keelwerk/data'), core],
  ['core source, a package of another origin', 'packages/core/src/other.ts', use('zod'), 'allowed'],
];

/** The testcontainers rule: its forms in a package's source, then the kinds of file. */
export const containerCases: readonly ImportRuleCase[] = [
  ['source, import', 'packages/x/src/import.ts', use('testcontainers'), container],
  [
    'source, type-only import',
    'packages/x/src/type-only.ts',
    "import type { StartedTestContainer } from 'testcontainers';\nexport type T = StartedTestContainer;\n",
    container,
  ],
  [
    'source, subpath',
    'packages/x/src/subpath.ts',
    use('testcontainers/build/generic-container'),
    container,
  ],
  [
    'source, the PostgreSQL package',
    'packages/x/src/postgres.ts',
    use('@testcontainers/postgresql'),
    container,
  ],
  [
    'source, subpath of the PostgreSQL package',
    'packages/x/src/postgres-subpath.ts',
    use('@testcontainers/postgresql/build/x'),
    container,
  ],
  [
    'source, re-export',
    'packages/x/src/re-export.ts',
    "export { GenericContainer } from 'testcontainers';\n",
    container,
  ],
  [
    'source, dynamic import',
    'packages/x/src/dynamic.ts',
    "export const load = (): Promise<unknown> => import('testcontainers');\n",
    container,
  ],
  [
    'source, require',
    'packages/x/src/require.ts',
    "export const loaded: unknown = require('testcontainers');\n",
    container,
  ],
  [
    'source, re-export of everything',
    'packages/x/src/re-export-all.ts',
    "export * from 'testcontainers';\n",
    container,
  ],
  [
    'source, import equals require',
    'packages/x/src/import-equals.ts',
    "import tc = require('testcontainers');\nexport const x = tc;\n",
    container,
  ],
  [
    'source, exported import equals require, one message',
    'packages/x/src/export-import-equals.ts',
    "export import tc = require('testcontainers');\n",
    container,
  ],
  [
    'source, dynamic import of a template literal',
    'packages/x/src/dynamic-template.ts',
    'export const load = (): Promise<unknown> => import(`testcontainers`);\n',
    container,
  ],
  [
    'source, dynamic import of a template literal with a substitution after the package',
    'packages/x/src/dynamic-substitution.ts',
    // The sample's own text holds a template literal with a substitution, so this one escapes both.
    `export const load = (s: string): Promise<unknown> => import(\`testcontainers/\${s}\`);\n`,
    container,
  ],
  [
    'source, require of a template literal',
    'packages/x/src/require-template.ts',
    'export const loaded: unknown = require(`testcontainers`);\n',
    container,
  ],
  [
    'source, require of a conditional with the name in one branch',
    'packages/x/src/require-conditional.ts',
    "export const loaded = (c: boolean): unknown => require(c ? 'testcontainers' : 'other');\n",
    container,
  ],
  [
    'source, require in parentheses',
    'packages/x/src/require-parentheses.ts',
    "export const loaded: unknown = (require)('testcontainers');\n",
    container,
  ],
  [
    'source, require in parentheses with block comments',
    'packages/x/src/require-block-comments.ts',
    "export const loaded: unknown = (/* c */ require /* d */)('testcontainers');\n",
    container,
  ],
  [
    'source, require in parentheses with a block comment over two lines',
    'packages/x/src/require-multiline-comment.ts',
    "export const loaded: unknown = (/* a\n b */ require)('testcontainers');\n",
    container,
  ],
  [
    'source, require in parentheses with line comments',
    'packages/x/src/require-line-comments.ts',
    "export const loaded: unknown = (\n  // c\n  require // d\n)('testcontainers');\n",
    container,
  ],
  [
    'source, a call of another function with the name',
    'packages/x/src/other-call.ts',
    "export const loaded: unknown = load('testcontainers');\n",
    'allowed',
  ],
  [
    'source, a name put together when the code runs',
    'packages/x/src/put-together.ts',
    "export const loaded: unknown = require('test' + 'containers');\n",
    'allowed',
  ],
  ['source, another module', 'packages/x/src/other.ts', use('testcontainers-extras'), 'allowed'],
  ['test file', 'packages/x/src/in-test.test.ts', use('testcontainers'), container],
  ['script', 'scripts/in-script.ts', use('testcontainers'), container],
  ['configuration file', 'packages/x/vitest.config.ts', use('testcontainers'), container],
  [
    'the place of startPostgres, source',
    `${place}/start.ts`,
    use('@testcontainers/postgresql'),
    'allowed',
  ],
  ['the place of startPostgres, test', `${place}/start.test.ts`, use('testcontainers'), 'allowed'],
  [
    'below the place of startPostgres',
    `${place}/sub/start.ts`,
    use('@testcontainers/postgresql'),
    'allowed',
  ],
  [
    'a directory of that name inside a package',
    `packages/x/${place}/start.ts`,
    use('@testcontainers/postgresql'),
    container,
  ],
  [
    'a directory of that name inside an example',
    `examples/x/${place}/start.ts`,
    use('@testcontainers/postgresql'),
    container,
  ],
];
