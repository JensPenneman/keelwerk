import { readFileSync } from 'node:fs';
import { canonicalizeJson, transientPurgeTypes } from '@keelwerk/core';
import { sha256 } from '@keelwerk/core/crypto';
import { expect, test } from 'vitest';
import { commandReceiptTable } from './command-receipt-table.ts';
import type { FrameworkStep } from './framework-step.ts';
import { frameworkStepChecksum } from './framework-step-checksum.ts';
import { frameworkSteps } from './framework-steps.ts';
import { queuedJobStates } from './queued-job-states.ts';

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

test('step 0003 of the control store is the stored format and a namespace has no statement', async () => {
  await expect(renderStep(stepOf('0003'), 'kw__control', control)).toMatchFileSnapshot(
    './golden/control-0003.sql',
  );
  expect(stepOf('0003').ddl('example', {})).toEqual([]);
  expect(stepOf('0003').grants('kw__control', 'kw_app', control)).toEqual([]);
});

test('step 0003 indexes the erasure identity, the tombstone key and the tombstone scope', () => {
  const statements = stepOf('0003').ddl('kw__control', control);
  expect(statements).toHaveLength(3);
  expect(statements.map((statement) => /^create index (\w+) /.exec(statement)?.[1])).toEqual([
    'kw_ledger_erasure_identity',
    'kw_ledger_tombstone_key',
    'kw_ledger_tombstone_scope',
  ]);
  expect(stepOf('0003').marker).toBe('kw_ledger_erasure_identity');
});

test('step 0004 of a namespace and of the control store is the stored format', async () => {
  await expect(renderStep(stepOf('0004'), 'example', {})).toMatchFileSnapshot(
    './golden/namespace-0004.sql',
  );
  await expect(renderStep(stepOf('0004'), 'kw__control', control)).toMatchFileSnapshot(
    './golden/control-0004.sql',
  );
});

test('step 0004 keeps the index, adds the purge function and the run columns, and no delete path', () => {
  const namespace = stepOf('0004').ddl('example', {});
  const controlStatements = stepOf('0004').ddl('kw__control', control);
  expect(namespace.map((statement) => statement.split('\n')[0])).toEqual([
    `create index kw_events_transient on "example".kw_events (scope_id, recorded_at, position) where transient and stream_type = 'core.commandReceipt'`,
    'create function "example".kw_purge_transient(before timestamptz, max_rows integer, stream_types text[]) returns table (removed integer, more boolean, records jsonb)',
    'revoke execute on function "example".kw_purge_transient(timestamptz, integer, text[]) from public',
  ]);
  expect(controlStatements.map((statement) => statement.split('\n')[0])).toEqual([
    `create index kw_events_transient on "kw__control".kw_events (scope_id, recorded_at, position) where transient and stream_type = 'core.commandReceipt'`,
    'alter table "kw__control".kw_retention_runs add column namespace_id text, add column outcome text, add column error jsonb',
    'create function "kw__control".kw_purge_transient(before timestamptz, max_rows integer, stream_types text[]) returns table (removed integer, more boolean, records jsonb)',
    'revoke execute on function "kw__control".kw_purge_transient(timestamptz, integer, text[]) from public',
  ]);
  expect(stepOf('0004').marker).toBe('kw_events_transient');
  // The role may execute the function and holds no delete grant and no policy of its own.
  expect(stepOf('0004').grants('example', 'kw_app', {})).toEqual([
    'grant execute on function "example".kw_purge_transient(timestamptz, integer, text[]) to "kw_app"',
  ]);
  for (const statement of [
    ...namespace,
    ...controlStatements,
    ...stepOf('0004').grants('example', 'kw_app', {}),
  ]) {
    expect(statement).not.toMatch(/\bgrant delete\b|create policy/);
  }
});

test('step 0005 of a namespace and of the control store is the stored format', async () => {
  await expect(renderStep(stepOf('0005'), 'example', {})).toMatchFileSnapshot(
    './golden/namespace-0005.sql',
  );
  await expect(renderStep(stepOf('0005'), 'kw__control', control)).toMatchFileSnapshot(
    './golden/control-0005.sql',
  );
});

test('step 0005 indexes the jobs that wait to run by scope and queue, with the set of states the reads use', () => {
  for (const [root, options] of [
    ['example', {}],
    ['kw__control', control],
  ] as const) {
    expect(stepOf('0005').ddl(root, options)).toEqual([
      `create index kw_jobs_queued on "${root}".kw_jobs (scope_id, queue) where state in ${queuedJobStates}`,
    ]);
  }
  expect(queuedJobStates).toBe("('scheduled', 'available', 'waiting')");
  expect(stepOf('0005').ddl('kw__root', control)).toEqual(stepOf('0005').ddl('kw__root', {}));
  expect(stepOf('0005').marker).toBe('kw_jobs_queued');
  expect(stepOf('0005').grants('example', 'kw_app', {})).toEqual([]);
});

test('the purge function is owner-owned, pins its search path and names every table with its schema', () => {
  for (const [root, options] of [
    ['example', {}],
    ['kw__control', control],
  ] as const) {
    const body = stepOf('0004').ddl(root, options)[options === control ? 2 : 1] ?? '';
    expect(body).toContain('security definer');
    expect(body).toContain('set search_path = pg_catalog, pg_temp');
    // Every table of the body is qualified with the root; no other `from` or `using` target exists.
    const code = body.replaceAll(/'[^']*'/g, "''");
    const targets = [...code.matchAll(/\b(?:from|using|join)\s+([A-Za-z_"]\S*)/g)].map(
      (match) => match[1],
    );
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      // `from doomed` and `from deleted` are the CTEs; `using errcode` belongs to `raise`.
      if (target === 'doomed' || target === 'deleted' || target === 'errcode') continue;
      expect(target).toMatch(new RegExp(`^"${root}"\\.(kw_events|core__command_receipt)$`));
    }
    expect(body).toContain(
      "current_setting('keelwerk.scope', true) is not distinct from 'namespace'",
    );
    expect(body).toContain('unit_scope is null');
    expect(body).toContain('max_rows < 1 or max_rows > 100000');
    expect(body).toContain('e.hash is null and e.prev_hash is null');
    // The type is a literal in every candidate predicate and in the delete, never the argument
    // (the plan then walks the partial index in order), and the argument is only checked against
    // the one type: the candidate predicate, the delete and `more`, in both variants.
    expect(body.match(/\.stream_type = 'core\.commandReceipt'/g)).toHaveLength(6);
    expect(body).not.toMatch(/any\(stream_types\)/);
    expect(body).toContain('if stream_types is null then');
    expect(body).toContain("if not (stream_types <@ array['core.commandReceipt']::text[]) then");
    expect(body).toContain('if cutoff is null then');
  }
});

test('the function of the control root reads the deployment as the unit scope, an application root the tenant, backend, then deployment', () => {
  const unitScope = (statements: readonly string[]): string =>
    /unit_scope uuid := (.*);/.exec(
      statements.find((s) => s.startsWith('create function')) ?? '',
    )?.[1] ?? '';
  expect(unitScope(stepOf('0004').ddl('kw__control', control))).toBe(
    "nullif(current_setting('keelwerk.deployment_id', true), '')::uuid",
  );
  expect(unitScope(stepOf('0004').ddl('example', {}))).toBe(
    "coalesce(nullif(current_setting('keelwerk.tenant_id', true), '')::uuid, nullif(current_setting('keelwerk.backend_id', true), '')::uuid, nullif(current_setting('keelwerk.deployment_id', true), '')::uuid)",
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
      // Step 0003 has no statement for a namespace root: both roots render the same empty list.
      if (step.id !== '0003' || options === control) {
        expect(step.ddl('a', options)).not.toEqual(step.ddl('b', options));
      }
      expect(asRoot(step.ddl('a', options), 'a', 'b')).toEqual(step.ddl('b', options));
      expect(frameworkStepChecksum(step, options)).toBe(
        sha256(canonicalizeJson(step.ddl('kw__root', options))),
      );
    }
    // Step 0005 indexes `kw_jobs`, which both kinds of root have alike: one statement, one checksum.
    if (step.id !== '0005') {
      expect(frameworkStepChecksum(step, control)).not.toBe(frameworkStepChecksum(step, {}));
    }
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

test('the one stream type the function may purge is a literal of the step and holds every type retention lists', () => {
  for (const [root, options] of [
    ['example', {}],
    ['kw__control', control],
  ] as const) {
    const statements = stepOf('0004').ddl(root, options);
    const text = statements.join('\n');
    const body = statements.find((statement) => statement.startsWith('create function')) ?? '';
    const index = statements[0] ?? '';
    // Widening the kernel's list needs a new framework step that replaces the function: the
    // stored one would refuse the new type (42501) and its checksum must not move.
    for (const type of transientPurgeTypes) {
      expect(index).toContain(`stream_type = '${type}'`);
      expect(body).toContain(`array['${type}']::text[]`);
      expect(body).toContain(`stream_type = '${type}'`);
    }
    expect(text).not.toContain('transientPurgeTypes');
    // Only the receipt types are named: the literal list is exactly the kernel's list.
    const named = new Set(text.match(/'core\.[A-Za-z]+'/g));
    expect([...named]).toEqual(transientPurgeTypes.map((type) => `'${type}'`));
  }
});

test('the receipt table the function reads is the one the receipt store writes', () => {
  const body = stepOf('0004').ddl('example', {})[1] ?? '';
  expect(body).toContain(`"example".${commandReceiptTable} as r`);
});
