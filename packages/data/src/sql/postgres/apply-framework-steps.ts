import { errors } from '@keelwerk/core';
import { encodeInstant } from '../encode-instant.ts';
import { assertNamespaceRoot } from './assert-namespace-root.ts';
import { frameworkStepChecksum } from './framework-step-checksum.ts';
import { frameworkSteps } from './framework-steps.ts';
import { frameworkTrack } from './framework-track.ts';
import { quoteIdentifier } from './quote-identifier.ts';
import type { SchemaSession } from './schema-session.ts';

/**
 * Brings one root's framework track up to date inside the caller's transaction, which holds the
 * `apply` lock (S-117). In order over `frameworkSteps`: a recorded step is checked against its
 * checksum (another checksum is a `conflict`); a step without a row whose marker table exists is
 * recorded without running (a root created before the step existed, or a history that was
 * truncated); any other step runs its DDL, then its grants when a role is given, then is recorded.
 * A recorded step this build does not know is left alone. Answers the ids whose DDL ran.
 */
export async function applyFrameworkSteps(
  session: SchemaSession,
  input: {
    readonly root: string;
    readonly control: boolean;
    readonly role: string | undefined;
    /** The root did not exist: step 0001 creates it. */
    readonly fresh: boolean;
    /** `applied_at` of every row this call writes: the adapter's clock, never the database's. */
    readonly now: Temporal.Instant;
  },
): Promise<readonly string[]> {
  const root = assertNamespaceRoot(input.root);
  const options = input.control ? { control: true } : {};
  const history = quoteIdentifier(root);
  const present = async (table: string): Promise<boolean> => {
    const found = await session.query('select to_regclass($1::text) is not null as present', [
      `${history}.${table}`,
    ]);
    return found.rows[0]?.present === true;
  };
  const recorded = new Map<string, string>();
  if (!input.fresh) {
    if (!(await present('kw_migrations'))) {
      throw errors.conflict(`${root} is not a keelwerk namespace: it has no kw_migrations`);
    }
    const rows = await session.query(
      `select id, checksum from ${history}.kw_migrations where track = $1`,
      [frameworkTrack],
    );
    for (const row of rows.rows) recorded.set(String(row.id), String(row.checksum));
  }
  const ran: string[] = [];
  for (const step of frameworkSteps) {
    const checksum = frameworkStepChecksum(step, options);
    const found = recorded.get(step.id);
    if (found !== undefined) {
      if (found !== checksum) {
        throw errors.conflict(`framework step ${step.id} of ${root} changed after it was applied`);
      }
      continue;
    }
    const statements = step.ddl(root, options);
    const started = performance.now();
    const recognised = !input.fresh && (await present(step.marker));
    if (!recognised) {
      for (const statement of statements) await session.query(statement);
      if (input.role !== undefined) {
        for (const statement of step.grants(root, input.role, options)) {
          await session.query(statement);
        }
      }
      ran.push(step.id);
    }
    await session.query(
      `insert into ${history}.kw_migrations (track, id, checksum, applied_at, duration_ms, steps_applied)
       values ($1, $2, $3, $4::timestamptz, $5, $6)`,
      [
        frameworkTrack,
        step.id,
        checksum,
        encodeInstant(input.now),
        recognised ? 0 : Math.round(performance.now() - started),
        statements.length,
      ],
    );
  }
  return ran;
}
