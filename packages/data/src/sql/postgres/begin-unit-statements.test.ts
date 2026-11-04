import { describe, expect, test } from 'vitest';
import { beginUnitStatements } from './begin-unit-statements.ts';

describe('beginUnitStatements', () => {
  test('a tenant command: read committed, the tenant id and the local timeout in one statement', () => {
    expect(
      beginUnitStatements({
        scope: { level: 'tenant', backendId: 'b', tenantId: 't' },
        readOnly: false,
        timeoutMs: 5000,
      }),
    ).toEqual({
      begin: 'begin isolation level read committed read write',
      settings: [
        {
          sql: "select set_config('keelwerk.tenant_id', $1, true), set_config('statement_timeout', $2, true)",
          parameters: ['t', '5000'],
        },
      ],
    });
  });

  test('a query is repeatable read and read only; a backend unit sets only the backend id', () => {
    expect(
      beginUnitStatements({ scope: { level: 'backend', backendId: 'b' }, readOnly: true }),
    ).toEqual({
      begin: 'begin isolation level repeatable read read only',
      settings: [{ sql: "select set_config('keelwerk.backend_id', $1, true)", parameters: ['b'] }],
    });
  });

  test('a namespace unit sets the namespace scope, a deployment unit its deployment id', () => {
    expect(
      beginUnitStatements({
        scope: { level: 'namespace', reason: 'migrate' },
        readOnly: false,
        isolation: 'serializable',
      }),
    ).toEqual({
      begin: 'begin isolation level serializable read write',
      settings: [
        { sql: "select set_config('keelwerk.scope', $1, true)", parameters: ['namespace'] },
      ],
    });
    expect(
      beginUnitStatements({ scope: { level: 'deployment' }, readOnly: false, deploymentId: 'd1' })
        .settings,
    ).toEqual([
      { sql: "select set_config('keelwerk.deployment_id', $1, true)", parameters: ['d1'] },
    ]);
  });

  test('a deployment unit without a deployment id is refused', () => {
    expect(() => beginUnitStatements({ scope: { level: 'deployment' }, readOnly: false })).toThrow(
      TypeError,
    );
  });

  test('PGlite drops to the role first', () => {
    const { settings } = beginUnitStatements({
      scope: { level: 'namespace', reason: 'migrate' },
      readOnly: false,
      role: 'keelwerk_app',
    });
    expect(settings[0]).toEqual({ sql: 'set local role "keelwerk_app"', parameters: [] });
  });

  test('a role that is not a plain name and a bad timeout are refused', () => {
    const base = { scope: { level: 'deployment' }, deploymentId: 'd1', readOnly: false } as const;
    expect(() => beginUnitStatements({ ...base, role: 'x"; drop' })).toThrow(TypeError);
    expect(() => beginUnitStatements({ ...base, timeoutMs: 0 })).toThrow(TypeError);
    expect(() => beginUnitStatements({ ...base, timeoutMs: 1.5 })).toThrow(TypeError);
  });

  test('the tenant id is a parameter, never part of the text', () => {
    const { settings } = beginUnitStatements({
      scope: { level: 'tenant', backendId: 'b', tenantId: "t'; drop table x; --" },
      readOnly: false,
    });
    expect(settings[0]?.sql).not.toContain('drop');
    expect(settings[0]?.parameters).toEqual(["t'; drop table x; --"]);
  });
});
