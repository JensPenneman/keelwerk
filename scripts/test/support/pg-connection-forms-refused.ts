/**
 * One case per form, named by its form: the source of a file in `packages/x/src` that the rule
 * refuses. Each holds a module name written out as a literal, as the module of an import or an
 * export, or inside the first argument of a dynamic import or a require. With the forms in
 * pg-connection-forms-allowed.ts this list is the claim of the rule.
 */
export const refusedForms: readonly (readonly [
  form: string,
  source: string,
  verdict: 'refused',
])[] = [
  ['a default import', "import pg from 'pg';\nexport const driver = pg;\n", 'refused'],
  ['a namespace import', "import * as pg from 'pg';\nexport const driver = pg;\n", 'refused'],
  ['a named import', "import { Pool } from 'pg';\nexport const driver = Pool;\n", 'refused'],
  [
    'a named import under another name',
    "import { Client as PgClient } from 'pg';\nexport const driver = PgClient;\n",
    'refused',
  ],
  [
    'a named import of a name the rule has no list of',
    "import { types } from 'pg';\nexport const driver = types;\n",
    'refused',
  ],
  [
    'default as among named imports',
    "import { default as pg, type Pool } from 'pg';\nexport const driver: Pool | undefined = pg;\n",
    'refused',
  ],
  [
    'a default import written together with named ones',
    "import pg, { Pool } from 'pg';\nexport const driver = [pg, Pool];\n",
    'refused',
  ],
  [
    'a default import written together with type specifiers',
    "import pg, { type Pool } from 'pg';\nexport const driver: Pool | undefined = pg;\n",
    'refused',
  ],
  [
    'a default import written together with a namespace',
    "import pg, * as everything from 'pg';\nexport const driver = [pg, everything];\n",
    'refused',
  ],
  [
    'a named import with a value among type specifiers',
    "import { type Pool, Client } from 'pg';\nexport const driver: Pool | undefined = new Client();\n",
    'refused',
  ],
  [
    'a named import with a value among type specifiers over several lines',
    "import {\n  type Pool,\n  Client,\n} from 'pg';\nexport const driver: Pool | undefined = new Client();\n",
    'refused',
  ],
  ['a bare import', "import 'pg';\n", 'refused'],
  ['an import without specifiers', "import {} from 'pg';\n", 'refused'],
  [
    'a named import of a specifier named by a string',
    "import { 'Client' as PgClient } from 'pg';\nexport const driver = PgClient;\n",
    'refused',
  ],
  [
    'a named import of a string-named specifier among type specifiers',
    "import { type Pool, 'Client' as PgClient } from 'pg';\nexport const driver: Pool | undefined = PgClient;\n",
    'refused',
  ],
  [
    'a named import of the name type, renamed',
    "import { type as PgType } from 'pg';\nexport const driver = PgType;\n",
    'refused',
  ],
  [
    'a named import of the name as, renamed from type',
    "import { type as as } from 'pg';\nexport const driver = as;\n",
    'refused',
  ],
  [
    'a named import of the name type',
    "import { type } from 'pg';\nexport const driver = type;\n",
    'refused',
  ],
  [
    'a default import of the name type',
    "import type from 'pg';\nexport const driver = type;\n",
    'refused',
  ],
  [
    'a default import of the name type with no space before the module',
    "import type from'pg';\nexport const driver = type;\n",
    'refused',
  ],
  [
    'a default import of the name type with a comment before the module',
    "import type /* c */ from 'pg';\nexport const driver = type;\n",
    'refused',
  ],
  [
    'a default import of the name type written together with named ones',
    "import type, { Pool } from 'pg';\nexport const driver = [type, Pool];\n",
    'refused',
  ],
  [
    'a default import with a comment before the module',
    "import pg from /* c */ 'pg';\nexport const driver = pg;\n",
    'refused',
  ],
  [
    'a default import with no space before the module',
    "import pg from'pg';\nexport const driver = pg;\n",
    'refused',
  ],
  [
    'a default import of the pool package',
    "import Pool from 'pg-pool';\nexport const driver = Pool;\n",
    'refused',
  ],
  [
    'a default import of a path inside the driver',
    "import Client from 'pg/lib/client';\nexport const driver = Client;\n",
    'refused',
  ],
  ['a re-export of a name', "export { Pool } from 'pg';\n", 'refused'],
  ['a re-export of the default', "export { default } from 'pg';\n", 'refused'],
  ['a re-export of the default under a name', "export { default as pg } from 'pg';\n", 'refused'],
  ['a re-export of everything', "export * from 'pg';\n", 'refused'],
  ['a re-export of everything as a namespace', "export * as pg from 'pg';\n", 'refused'],
  [
    'a re-export of a specifier named by a string',
    "export { 'Client' as PgClient } from 'pg';\n",
    'refused',
  ],
  ['a re-export of the name type', "export { type } from 'pg';\n", 'refused'],
  ['a re-export without specifiers', "export {} from 'pg';\n", 'refused'],
  ['a re-export with a comment before the module', "export * from /* c */ 'pg';\n", 'refused'],
  [
    'a re-export with a value among type specifiers',
    "export { type Pool, Client } from 'pg';\n",
    'refused',
  ],
  ['a dynamic import', "export const load = () => import('pg');\n", 'refused'],
  [
    'a dynamic import of the pool package with options',
    "export const load = () => import('pg-pool', { with: {} });\n",
    'refused',
  ],
  [
    'a dynamic import with a comment before the module',
    "export const load = () => import(/* c */ 'pg');\n",
    'refused',
  ],
  [
    'a dynamic import with line comments around the module',
    "export const load = () =>\n  import(\n    // c\n    'pg' // d\n  );\n",
    'refused',
  ],
  [
    'a dynamic import of a template literal',
    'export const load = () => import(`pg`);\n',
    'refused',
  ],
  ['a require', "export const driver = require('pg');\n", 'refused'],
  [
    'a require with a comment before the module',
    "export const driver = require(/* c */ 'pg');\n",
    'refused',
  ],
  [
    'a require with a comment before the call',
    "export const driver = require/* c */('pg');\n",
    'refused',
  ],
  [
    'a require with line comments around the module',
    "export const driver = require(\n  // c\n  'pg' // d\n);\n",
    'refused',
  ],
  ['a require of a template literal', 'export const driver = require(`pg`);\n', 'refused'],
  [
    'a require called through optional chaining',
    "export const driver = require?.('pg');\n",
    'refused',
  ],
  [
    'a require in parentheses with comments',
    "export const driver = (/* c */ require /* d */)('pg');\n",
    'refused',
  ],
  ['a require in parentheses', "export const driver = (require)('pg');\n", 'refused'],
  ['a require of the pool package', 'export const driver = require("pg-pool");\n', 'refused'],
  [
    'an import equals require',
    "import pg = require('pg');\nexport const driver = pg;\n",
    'refused',
  ],
  [
    'an import equals require with a comment before the module',
    "import pg = require(/* c */ 'pg');\nexport const driver = pg;\n",
    'refused',
  ],
  ['an exported import equals require', "export import pg = require('pg');\n", 'refused'],
  [
    'a default import of a module name with a hex escape',
    "import pg from 'p\\x67';\nexport const driver = pg;\n",
    'refused',
  ],
  [
    'a default import of a module name with a unicode escape',
    "import pg from 'p\\u0067';\nexport const driver = pg;\n",
    'refused',
  ],
  [
    'a named import of the pool package with an escape',
    'import { Pool } from "pg-poo\\l";\nexport const driver = Pool;\n',
    'refused',
  ],
  ['a star re-export of a module name with an escape', "export * from 'p\\g';\n", 'refused'],
  [
    'an import equals require of a module name with an escape',
    "import pg = require('\\x70g');\nexport const driver = pg;\n",
    'refused',
  ],
  [
    'a dynamic import of a module name with an escape',
    "export const load = () => import('p\\x67');\n",
    'refused',
  ],
  [
    'a dynamic import of a template literal with an escape',
    'export const load = () => import(`p\\x67`);\n',
    'refused',
  ],
  [
    'a require of a module name with an escape',
    "export const driver = require('p\\x67');\n",
    'refused',
  ],
  [
    'an import of another module whose name has an escape',
    "import { Pool } from './p\\x6fol.ts';\nexport const driver = Pool;\n",
    'refused',
  ],
  [
    'a dynamic import of a module in parentheses',
    "export const load = () => import(('pg'));\n",
    'refused',
  ],
  [
    'a dynamic import of a module with as',
    "export const load = () => import('pg' as string);\n",
    'refused',
  ],
  [
    'a dynamic import of a module with satisfies',
    "export const load = () => import('pg' satisfies string);\n",
    'refused',
  ],
  [
    'a dynamic import of a module with a non-null assertion',
    "export const load = () => import('pg'!);\n",
    'refused',
  ],
  [
    'a dynamic import of a module after a comma',
    "export const load = () => import((0, 'pg'));\n",
    'refused',
  ],
  [
    'a dynamic import of a module chosen by a condition',
    "export const load = (flag: boolean) => import(flag ? 'pg' : './other.ts');\n",
    'refused',
  ],
  ['a require of a module in parentheses', "export const driver = require(('pg'));\n", 'refused'],
  ['a require of a module with as', "export const driver = require('pg' as string);\n", 'refused'],
  [
    'a require of a module with satisfies',
    "export const driver = require('pg' satisfies string);\n",
    'refused',
  ],
  [
    'a require of a module with a non-null assertion',
    "export const driver = require('pg'!);\n",
    'refused',
  ],
  ['a require of a module after a comma', "export const driver = require((0, 'pg'));\n", 'refused'],
  [
    'a require of a module chosen by a condition',
    "export const driver = (flag: boolean) => require(flag ? 'pg' : './other.ts');\n",
    'refused',
  ],
  [
    'a dynamic import of a literal in a concatenation with a variable',
    "export const load = (x: string) => import('pg' + x);\n",
    'refused',
  ],
  [
    'a dynamic import of a template literal with a substitution after a driver path',
    `export const load = (x: string) => import(\`pg/\${x}\`);\n`,
    'refused',
  ],
];
