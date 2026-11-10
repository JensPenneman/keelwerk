import { readFileSync } from 'node:fs';
import { canonicalizeJson } from '@keelwerk/core';
import { sha256 } from '@keelwerk/core/crypto';
import { expect, test } from 'vitest';
import type { FrameworkStep } from './framework-step.ts';
import { frameworkStepChecksum } from './framework-step-checksum.ts';
import { frameworkSteps } from './framework-steps.ts';

const render = (statements: readonly string[]): string =>
  `${statements.map((statement) => `${statement};`).join('\n\n')}\n`;

const stepOf = (id: string): FrameworkStep => {
  const step = frameworkSteps.find((candidate) => candidate.id === id);
  if (step === undefined) throw new Error(`no framework step ${id}`);
  return step;
};

const renderStep = (
  step: FrameworkStep,
  root: string,
  options: { readonly control?: boolean },
): string => render([...step.ddl(root, options), ...step.grants(root, 'kw_app', options)]);

const control = { control: true } as const;

const policyNames = (statements: readonly string[], table: string): readonly string[] =>
  statements
    .map((statement) => new RegExp(`^create policy (\\w+) on "[^"]+"\\.${table} `).exec(statement))
    .flatMap((match) => (match?.[1] === undefined ? [] : [match[1]]));

const namespaceTables = [
  'kw_consumers',
  'kw_consumer_leases',
  'kw_parked',
  'kw_stream_records',
  'kw_schedules',
] as const;

const controlTables = [
  'kw_namespace_identities',
  'kw_scope_marks',
  'kw_leases',
  'kw_queue_pauses',
  'kw_ledger',
  'kw_api_usage',
  'kw_retention_runs',
] as const;

test('step 0001 is the M1 namespace DDL byte for byte', () => {
  const golden = readFileSync(new URL('./golden/namespace.sql', import.meta.url), 'utf8');
  expect(renderStep(stepOf('0001'), 'example', {})).toBe(golden);
});

test('step 0001 of the control store is the M1 control DDL', () => {
  const golden = readFileSync(new URL('./golden/control.sql', import.meta.url), 'utf8');
  expect(renderStep(stepOf('0001'), 'kw__control', control)).toBe(golden);
});

test('step 0002 of a namespace is the stored format', async () => {
  await expect(renderStep(stepOf('0002'), 'example', {})).toMatchFileSnapshot(
    './golden/namespace-0002.sql',
  );
});

test('step 0002 of the control store is the stored format', async () => {
  await expect(renderStep(stepOf('0002'), 'kw__control', control)).toMatchFileSnapshot(
    './golden/control-0002.sql',
  );
});

test('the step checksums are the stored values', async () => {
  const lines = ['namespace', 'control'].flatMap((kind) =>
    frameworkSteps.map(
      (step) =>
        `${kind} ${step.id} ${frameworkStepChecksum(step, kind === 'control' ? control : {})}`,
    ),
  );
  await expect(`${lines.join('\n')}\n`).toMatchFileSnapshot('./golden/framework-checksums.txt');
});

test('the root appears only as the quoted schema, so the template checksum stands for every root', () => {
  const asRoot = (statements: readonly string[], from: string, to: string): readonly string[] =>
    statements.map((statement) =>
      statement
        .replaceAll(`"${from}".`, `"${to}".`)
        .replaceAll(`schema "${from}"`, `schema "${to}"`)
        .replaceAll(`on "${from}"`, `on "${to}"`),
    );
  for (const step of frameworkSteps) {
    for (const options of [{}, control]) {
      expect(step.ddl('a', options)).not.toEqual(step.ddl('b', options));
      expect(asRoot(step.ddl('a', options), 'a', 'b')).toEqual(step.ddl('b', options));
      expect(frameworkStepChecksum(step, options)).toBe(
        sha256(canonicalizeJson(step.ddl('kw__root', options))),
      );
    }
    expect(frameworkStepChecksum(step, control)).not.toBe(frameworkStepChecksum(step, {}));
  }
});

test('every M2 table has forced row-level security and its policy set', () => {
  const step = stepOf('0002');
  const namespace = step.ddl('example', {});
  const controlStore = step.ddl('kw__control', control);
  for (const [statements, tables] of [
    [namespace, namespaceTables],
    [controlStore, [...namespaceTables, ...controlTables]],
  ] as const) {
    for (const table of tables) {
      expect(statements).toContain(
        `alter table "${statements === namespace ? 'example' : 'kw__control'}".${table} enable row level security`,
      );
      expect(statements).toContain(
        `alter table "${statements === namespace ? 'example' : 'kw__control'}".${table} force row level security`,
      );
    }
  }
  for (const table of ['kw_consumers', 'kw_parked', 'kw_stream_records', 'kw_schedules']) {
    expect(policyNames(namespace, table)).toEqual(['scoped', 'maintenance']);
    expect(policyNames(controlStore, table)).toEqual(['scoped', 'maintenance']);
  }
  expect(policyNames(namespace, 'kw_consumer_leases')).toEqual(['take']);
  expect(policyNames(controlStore, 'kw_consumer_leases')).toEqual(['take']);
  for (const table of controlTables) {
    expect(policyNames(controlStore, table)).toEqual(['deployment']);
    expect(namespace.some((statement) => statement.includes(`.${table} `))).toBe(false);
  }
});

test('the ledger and the retention runs are granted select and insert only', () => {
  const grants = stepOf('0002').grants('kw__control', 'kw_app', control);
  expect(grants).toContain('grant select, insert on "kw__control".kw_ledger to "kw_app"');
  expect(grants).toContain('grant select, insert on "kw__control".kw_retention_runs to "kw_app"');
  expect(grants.filter((grant) => /kw_(ledger|retention_runs)\b/.test(grant))).toHaveLength(2);
  expect(grants.filter((grant) => grant.includes('usage on schema'))).toHaveLength(0);
});

test('the M1 dump fixture starts with the M1 golden files', () => {
  const golden = (name: string): string =>
    readFileSync(new URL(`./golden/${name}`, import.meta.url), 'utf8');
  const dump = readFileSync(new URL('../../../test/fixtures/m1-dump.sql', import.meta.url), 'utf8');
  expect(
    dump.startsWith(`${golden('control.sql')}\n${golden('namespace.sql')}\n-- M1 rows\n`),
  ).toBe(true);
});
