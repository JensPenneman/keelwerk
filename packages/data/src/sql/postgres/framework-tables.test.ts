import { expect, test } from 'vitest';
import { applicationRoleDdl } from './application-role.ts';
import { frameworkTablesDdl } from './framework-tables.ts';
import { rlsPoliciesDdl } from './rls-policies.ts';

const render = (statements: readonly string[]): string =>
  `${statements.map((statement) => `${statement};`).join('\n\n')}\n`;

test('the namespace DDL is the stored format', async () => {
  const ddl = render([
    ...frameworkTablesDdl('example'),
    ...rlsPoliciesDdl('example'),
    ...applicationRoleDdl('example', 'kw_app'),
  ]);
  await expect(ddl).toMatchFileSnapshot('./golden/namespace.sql');
});

test('the control store DDL adds the scope keys', async () => {
  const ddl = render([
    ...frameworkTablesDdl('kw__control', { control: true }),
    ...rlsPoliciesDdl('kw__control', { control: true }),
    ...applicationRoleDdl('kw__control', 'kw_app', { control: true }),
  ]);
  await expect(ddl).toMatchFileSnapshot('./golden/control.sql');
});

test('roots and roles are emitted double-quoted', () => {
  const ddl = [
    ...frameworkTablesDdl('order'),
    ...rlsPoliciesDdl('order'),
    ...applicationRoleDdl('order', 'user'),
  ];
  expect(ddl[0]).toBe('create schema "order"');
  for (const statement of ddl) expect(statement).not.toMatch(/(?:on|schema|to) order\b/);
  expect(ddl).toContain('grant usage on schema "order" to "user"');
});

test('the append-only tables are granted select and insert only', () => {
  const grants = applicationRoleDdl('example', 'kw_app');
  expect(grants).toContain('grant select, insert on "example".kw_events to "kw_app"');
  expect(grants).toContain('grant select, insert on "example".kw_shapes to "kw_app"');
  expect(grants.filter((grant) => /kw_(events|shapes)\b/.test(grant))).toHaveLength(2);
});

test('a root or role that PostgreSQL would refuse is refused', () => {
  expect(() => frameworkTablesDdl('a; drop table b')).toThrow(TypeError);
  expect(() => frameworkTablesDdl('pg_admin')).toThrow(TypeError);
  expect(() => rlsPoliciesDdl('Upper')).toThrow(TypeError);
  expect(() => applicationRoleDdl('ok', 'bad role')).toThrow(TypeError);
  expect(() => applicationRoleDdl('ok', 'pg_monitor')).toThrow(TypeError);
});
