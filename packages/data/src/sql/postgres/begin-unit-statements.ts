import type { StorageScope, UnitOptions } from '@keelwerk/core';

const isolationLevels = {
  'read-committed': 'read committed',
  'repeatable-read': 'repeatable read',
  serializable: 'serializable',
} as const;

function scopeSettings(
  scope: StorageScope,
  deploymentId: string | undefined,
): readonly (readonly [string, string])[] {
  switch (scope.level) {
    case 'tenant':
      return [['keelwerk.tenant_id', scope.tenantId]];
    case 'backend':
      return [['keelwerk.backend_id', scope.backendId]];
    case 'namespace':
      return [['keelwerk.scope', 'namespace']];
    case 'deployment':
      // The policies admit control-root rows only to a unit that names its deployment (F-12).
      if (deploymentId === undefined || deploymentId === '') {
        throw new TypeError('a deployment unit needs the deployment id');
      }
      return [['keelwerk.deployment_id', deploymentId]];
  }
}

/** A statement and its parameters, for a driver that takes text. */
export interface PostgresStatement {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/** The statements that open a unit, in the order they run. */
export interface BeginUnit {
  /** The transaction start, with its isolation level and access mode. */
  readonly begin: string;
  /** Run right after `begin`, in order: the role (PGlite), the scope and the local timeout. */
  readonly settings: readonly PostgresStatement[];
}

/** What opens a unit. */
export interface BeginUnitOptions {
  readonly scope: StorageScope;
  readonly readOnly: boolean;
  /** The deployment's id: required when the scope is `deployment`, becomes `keelwerk.deployment_id`. */
  readonly deploymentId?: string;
  readonly isolation?: UnitOptions['isolation'];
  /** The action's timeout: becomes a local `statement_timeout`. */
  readonly timeoutMs?: number;
  /** PGlite runs as its superuser, which row-level security never restricts: the unit drops to this role first. */
  readonly role?: string;
}

/**
 * The statements that open a unit on PostgreSQL (sections 14.3.6, 14.3.7): `begin` at the unit's
 * isolation (queries default to `repeatable read` read only, commands to `read committed`), then
 * the optional `set local role`, and one `select set_config(..., true)` that sets the tenant or
 * backend id or, for a deployment unit, the deployment id, which the row-level security policies read (or `keelwerk.scope = 'namespace'`) and the
 * local `statement_timeout`. Settings made with `set_config(..., true)` end with the transaction.
 */
export function beginUnitStatements(options: BeginUnitOptions): BeginUnit {
  const isolation = options.isolation ?? (options.readOnly ? 'repeatable-read' : 'read-committed');
  const settings: PostgresStatement[] = [];
  if (options.role !== undefined) {
    if (!/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(options.role)) {
      throw new TypeError(`${options.role} is not a role name`);
    }
    settings.push({ sql: `set local role "${options.role}"`, parameters: [] });
  }
  const entries: (readonly [string, string])[] = [
    ...scopeSettings(options.scope, options.deploymentId),
  ];
  if (options.timeoutMs !== undefined) {
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new TypeError('the unit timeout must be a positive number of milliseconds');
    }
    entries.push(['statement_timeout', String(options.timeoutMs)]);
  }
  if (entries.length > 0) {
    // The names are fixed above; only the values are parameters.
    const calls = entries.map(([name], index) => `set_config('${name}', $${index + 1}, true)`);
    settings.push({
      sql: `select ${calls.join(', ')}`,
      parameters: entries.map(([, value]) => value),
    });
  }
  return {
    begin: `begin isolation level ${isolationLevels[isolation]} ${options.readOnly ? 'read only' : 'read write'}`,
    settings,
  };
}
