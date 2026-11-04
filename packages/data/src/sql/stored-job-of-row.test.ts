// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import { expect, test } from 'vitest';
import type { SqlRow } from './run-sql.ts';
import { storedJobOfRow } from './stored-job-of-row.ts';

const tenantId = '00000000-0000-4000-8000-000000000101';
const backendId = '00000000-0000-4000-8000-000000000201';
const other = '00000000-0000-4000-8000-000000000999';

const row = (scope: unknown, scopeId: string): SqlRow => ({
  id: '1',
  scope_id: scopeId,
  scope: JSON.stringify(scope),
  attempt: 0,
  capability_set: '',
  run_at: '2026-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  queue: 'commands',
  input: JSON.stringify({ action: 'a', input: 1 }),
  principal: JSON.stringify({ resolver: 'system', principalId: 'p' }),
  causation: JSON.stringify({}),
  build_id: 'b1',
  revision: 1,
  kind: 'action',
  cap: 10,
  priority: 1,
  cost: 1,
  heartbeat_seconds: 10,
  api_version: null,
  key: null,
  ordering: 'none',
  group_spec: null,
  retry: null,
  expire_in_seconds: null,
  dead_letter: null,
});

test('a stored scope that names the row scope id is returned', () => {
  const scope = { level: 'tenant', backendId, tenantId };
  expect(storedJobOfRow(row(scope, tenantId)).scope).toEqual(scope);
  expect(storedJobOfRow(row({ level: 'backend', backendId }, backendId)).scope).toEqual({
    level: 'backend',
    backendId,
  });
});

test('a scope whose tenant or backend id differs from scope_id is refused', () => {
  expect(() =>
    storedJobOfRow(row({ level: 'tenant', backendId, tenantId: other }, tenantId)),
  ).toThrow(/names the scope/);
  expect(() => storedJobOfRow(row({ level: 'backend', backendId: other }, backendId))).toThrow(
    /names the scope/,
  );
  expect(() => storedJobOfRow(row(null, tenantId))).toThrow(/has no scope/);
});
