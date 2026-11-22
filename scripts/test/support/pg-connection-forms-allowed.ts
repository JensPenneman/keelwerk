/**
 * One case per form, named by its form: the source of a file in `packages/x/src` that the rule
 * leaves alone. The module name of each is a literal unless the form says it is not.
 */
export const allowedForms: readonly (readonly [
  form: string,
  source: string,
  verdict: 'allowed',
])[] = [
  [
    'a type import of the default',
    "import type pg from 'pg';\nexport const use = (client: pg.Client): void => client.removeAllListeners();\n",
    'allowed',
  ],
  [
    'a type import of the default of the pool package',
    "import type Pool from 'pg-pool';\nexport const use = (pool: Pool<unknown>): void => pool.removeAllListeners();\n",
    'allowed',
  ],
  [
    'a type import of a namespace',
    "import type * as pg from 'pg';\nexport const use = (client: pg.Client): void => client.removeAllListeners();\n",
    'allowed',
  ],
  [
    'a type import of named types',
    "import type { Client, Pool } from 'pg';\nexport const use = (a: Client, b: Pool): void => a.removeAllListeners(b);\n",
    'allowed',
  ],
  [
    'a named import whose specifiers are all type specifiers',
    "import { type Client } from 'pg';\nexport const use = (client: Client): void => client.removeAllListeners();\n",
    'allowed',
  ],
  [
    'a named import whose type specifiers span several lines',
    "import {\n  type Client,\n  type Pool,\n} from 'pg';\nexport const use = (a: Client, b: Pool): void => a.removeAllListeners(b);\n",
    'allowed',
  ],
  [
    'a type import of the default with a comment before the name',
    "import type /* c */ pg from 'pg';\nexport const use = (client: pg.Client): void => client.removeAllListeners();\n",
    'allowed',
  ],
  [
    'a type import of the default with a comment before the module',
    "import type pg from /* c */ 'pg';\nexport const use = (client: pg.Client): void => client.removeAllListeners();\n",
    'allowed',
  ],
  [
    'a type import equals require',
    "import type pg = require('pg');\nexport const use = (client: pg.Client): void => client.removeAllListeners();\n",
    'allowed',
  ],
  ['a type import without specifiers', "import type {} from 'pg';\n", 'allowed'],
  [
    'a type specifier with a comment inside',
    "import { type /* c */ Client, /* d */ type/* e */Pool } from 'pg';\nexport const use = (a: Client, b: Pool): void => a.removeAllListeners(b);\n",
    'allowed',
  ],
  [
    'type specifiers with line comments between them',
    "import {\n  // c\n  type Client, // d\n  // e\n  type Pool,\n} from 'pg';\nexport const use = (a: Client, b: Pool): void => a.removeAllListeners(b);\n",
    'allowed',
  ],
  [
    'a re-export of type specifiers with line comments between them',
    "export {\n  // c\n  type Client, // d\n  type Pool,\n} from 'pg';\n",
    'allowed',
  ],
  [
    'a type specifier renamed',
    "import { type Client as PgClient } from 'pg';\nexport const use = (client: PgClient): void => client.removeAllListeners();\n",
    'allowed',
  ],
  [
    'a type specifier named by a string, renamed',
    "import { type 'Client' as PgClient } from 'pg';\nexport const use = (client: PgClient): void => client.removeAllListeners();\n",
    'allowed',
  ],
  [
    'a type specifier of the name as',
    "import { type as } from 'pg';\nexport const use = (client: as): void => client.removeAllListeners();\n",
    'allowed',
  ],
  [
    'a type specifier of the name as, renamed from as',
    "import { type as as as } from 'pg';\nexport const use = (client: as): void => client.removeAllListeners();\n",
    'allowed',
  ],
  ['a type re-export of a name', "export type { Pool } from 'pg';\n", 'allowed'],
  ['a type re-export of everything as a namespace', "export type * as pg from 'pg';\n", 'allowed'],
  ['a type re-export without specifiers', "export type {} from 'pg';\n", 'allowed'],
  [
    'a type specifier in a re-export, renamed',
    "export { type Pool as PgPool } from 'pg';\n",
    'allowed',
  ],
  ['a type re-export of everything', "export type * from 'pg';\n", 'allowed'],
  ['a re-export of a type specifier', "export { type Pool } from 'pg';\n", 'allowed'],
  ['a type of a dynamic import', "export type Made = import('pg').Pool;\n", 'allowed'],
  [
    'an import of another module',
    "import { Pool } from './pool.ts';\nexport const driver = Pool;\n",
    'allowed',
  ],
  [
    'a dynamic import of another module',
    "export const load = () => import('./pool.ts');\n",
    'allowed',
  ],
  ['a require of another module', "export const driver = require('./pool.cjs');\n", 'allowed'],
  [
    'a read of the name Client on something else',
    'export const read = (other: { Client: string }): string => other.Client;\n',
    'allowed',
  ],
  [
    'a module name that is not a literal (the rule cannot see it)',
    "const name = 'pg';\nexport const load = () => import(name);\n",
    'allowed',
  ],
  [
    "a dynamic import of a module name that is a template literal with a substitution (the rule's stated limit)",
    `const prefix = 'p';\nexport const load = () => import(\`\${prefix}g\`);\n`,
    'allowed',
  ],
  [
    "a dynamic import of a module name that is a concatenation (the rule's stated limit)",
    "export const load = () => import('p' + 'g');\n",
    'allowed',
  ],
  [
    'a type import of a module name with an escape',
    "import type pg from 'p\\x67';\nexport const use = (client: pg.Client): void => client.removeAllListeners();\n",
    'allowed',
  ],
  [
    'a value from the place that creates the connections',
    "import { createPostgresClient } from '@keelwerk/adapter-postgres/connections';\nexport const driver = createPostgresClient;\n",
    'allowed',
  ],
];
