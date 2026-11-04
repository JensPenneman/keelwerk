import type { AppliedMigration, Clock, SchemaOperations } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { migrationChecksum } from '../../migrations/migration-checksum.ts';
import { upsertJobGroup } from '../upsert-job-group.ts';
import { applicationRoleDdl } from './application-role.ts';
import { assertNamespaceRoot } from './assert-namespace-root.ts';
import { frameworkTablesDdl } from './framework-tables.ts';
import { introspectCatalogue } from './introspect-catalogue.ts';
import { namespaceLock } from './namespace-lock.ts';
import { quoteIdentifier } from './quote-identifier.ts';
import { renderStep } from './render-step.ts';
import { rlsPoliciesDdl } from './rls-policies.ts';
import type { SchemaConnection } from './schema-connection.ts';
import type { SchemaSession } from './schema-session.ts';
import { snapshotSteps } from './snapshot-steps.ts';

const systemClock: Clock = { now: () => Temporal.Now.instant() };

const controlRoot = 'kw__control';

const isStatement = (sql: string): boolean => !sql.startsWith('--');

function instantOf(value: unknown): Temporal.Instant {
  if (value instanceof Date) return Temporal.Instant.fromEpochMilliseconds(value.getTime());
  return Temporal.Instant.from(String(value));
}

async function runAll(session: SchemaSession, statements: readonly string[]): Promise<void> {
  for (const statement of statements) if (isStatement(statement)) await session.query(statement);
}

/** How the PostgreSQL schema operations are set up. */
export interface PostgresSchemaOptions {
  /** The application role: granted the entity tables and the framework tables a namespace creates. */
  readonly role?: string;
  /** Stamps the token bucket of a provisioned group; the system clock by default. */
  readonly clock?: Clock;
}

/**
 * The schema contract on PostgreSQL (section 14.6.7), over any owner connection. `render` shows
 * the statements, `apply` (a file with a `data` step is refused: the kernel's runner does not exist yet) runs one file in one transaction under the namespace lock and records it
 * in `kw_migrations` (an applied file with another checksum is a conflict, an applied file with
 * the same checksum is skipped), `provision` creates a namespace's root, framework tables and the
 * tables of the given snapshots without replaying history, `introspect` reads the catalogue and
 * `lock` holds the planner's lock around several applies.
 */
export function postgresSchemaOperations(
  connection: SchemaConnection,
  options: PostgresSchemaOptions = {},
): SchemaOperations {
  const context = options.role === undefined ? {} : { role: options.role };
  return {
    render: (namespace, steps) =>
      steps.flatMap((step) => renderStep(assertNamespaceRoot(namespace.root), step, context)),
    apply: async (namespace, file) => {
      if (file.data !== undefined) {
        throw errors.unsupported(
          `migration ${file.id} of ${file.track} carries a data step, which waits for the kernel's runner (section 14.6.2)`,
        );
      }
      const root = assertNamespaceRoot(namespace.root);
      const checksum = migrationChecksum(file.steps);
      const statements = file.steps.flatMap((step) => renderStep(root, step, context));
      await connection.transaction(async (session) => {
        const lock = namespaceLock(root, 'apply');
        await session.query(lock.sql, lock.parameters);
        const history = quoteIdentifier(root);
        const applied = await session.query(
          `select checksum from ${history}.kw_migrations where track = $1 and id = $2`,
          [file.track, file.id],
        );
        const found = applied.rows[0];
        if (found !== undefined) {
          if (found.checksum === checksum) return;
          throw errors.conflict(
            `migration ${file.id} of ${file.track} changed after it was applied`,
          );
        }
        const started = performance.now();
        await runAll(session, statements);
        await session.query(
          `insert into ${history}.kw_migrations (track, id, checksum, applied_at, duration_ms, steps_applied)
           values ($1, $2, $3, now(), $4, $5)`,
          [
            file.track,
            file.id,
            checksum,
            Math.round(performance.now() - started),
            file.steps.length,
          ],
        );
      });
    },
    history: async (namespace) => {
      const root = assertNamespaceRoot(namespace.root);
      return connection.transaction(async (session) => {
        const result = await session.query(
          `select track, id, checksum, applied_at, steps_applied from ${quoteIdentifier(root)}.kw_migrations order by applied_at, track, id`,
        );
        return result.rows.map(
          (row): AppliedMigration => ({
            track: String(row.track),
            id: String(row.id),
            checksum: String(row.checksum),
            appliedAt: instantOf(row.applied_at),
            stepsApplied: Number(row.steps_applied),
          }),
        );
      });
    },
    provision: async (namespace, snapshots, provisionOptions) => {
      const root = assertNamespaceRoot(namespace.root);
      const control = root === controlRoot ? { control: true } : {};
      await connection.transaction(async (session) => {
        const lock = namespaceLock(root, 'apply');
        await session.query(lock.sql, lock.parameters);
        const present = await session.query('select 1 from pg_namespace where nspname = $1', [
          root,
        ]);
        if (present.rows.length === 0) {
          await runAll(session, [
            ...frameworkTablesDdl(root, control),
            ...rlsPoliciesDdl(root, control),
          ]);
          if (options.role !== undefined) {
            await runAll(session, applicationRoleDdl(root, options.role, control));
          }
        }
        for (const snapshot of snapshots) {
          const live = await introspectCatalogue(session, root);
          const steps = await snapshotSteps(snapshot, live.tables);
          await runAll(
            session,
            steps.flatMap((step) => renderStep(root, step, context)),
          );
        }
        for (const group of provisionOptions?.jobGroups ?? []) {
          if (group.scope !== 'namespace') continue;
          await upsertJobGroup(
            {
              root,
              now: (options.clock ?? systemClock).now(),
              run: async (sql, parameters) => {
                await session.query(sql, parameters);
              },
            },
            group,
            null,
          );
        }
      });
    },
    introspect: async (target) => {
      if ('namespace' in target) {
        const root = assertNamespaceRoot(target.namespace.root);
        return connection.transaction(async (session) => introspectCatalogue(session, root));
      }
      return connection.transaction(
        async (session) => introspectCatalogue(session, target.schema ?? 'public', target.tables),
        target.url,
      );
    },
    lock: async (namespace, fn) => connection.exclusive(assertNamespaceRoot(namespace.root), fn),
  };
}
