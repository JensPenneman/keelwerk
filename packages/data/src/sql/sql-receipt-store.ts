// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { PrincipalRef, Receipt, ReceiptOutcome, ReceiptStore } from '@keelwerk/core';
import { commandReceiptUuid, errors, KeelwerkError } from '@keelwerk/core';
import { sql } from 'kysely';
import { decodeInstant } from './decode-instant.ts';
import { encodeInstant } from './encode-instant.ts';
import { commandReceiptTable } from './postgres/command-receipt-table.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

type Raw = Readonly<Record<string, unknown>>;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function parsed(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function receiptOf(row: Raw): Receipt {
  const acknowledged = row.acknowledged_at;
  const seq = row.client_seq;
  return {
    commandId: String(row.command_id),
    action: String(row.action),
    fingerprint: String(row.fingerprint),
    principal: row.principal === null ? null : (parsed(row.principal) as PrincipalRef),
    status: String(row.status) as Receipt['status'],
    outcome: row.outcome === null ? null : (parsed(row.outcome) as ReceiptOutcome),
    apiVersion: String(row.api_version),
    request: {
      transport: String(row.transport),
      remoteAddress: text(row.remote_address),
      userAgent: text(row.user_agent),
    },
    clientId: text(row.client_id),
    clientSeq: seq === null || seq === undefined ? null : Number(seq),
    expiresAt: decodeInstant(row.expires_at),
    ...(acknowledged === null || acknowledged === undefined
      ? {}
      : { acknowledgedAt: decodeInstant(acknowledged) }),
  };
}

/** How long a concurrent duplicate waits on the first unit's receipt row before it answers `core.command_in_progress`. */
const claimWaitMs = 1000;

/** SQLSTATE `lock_not_available`: the statement waited longer than `lock_timeout`. */
const lockNotAvailable = '55P03';

function sqlStateOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const { code } = error;
  return typeof code === 'string' ? code : undefined;
}

const columns = [
  'command_id',
  'action',
  'fingerprint',
  'principal',
  'status',
  'outcome',
  'api_version',
  'transport',
  'remote_address',
  'user_agent',
  'client_id',
  'client_seq',
  'expires_at',
  'acknowledged_at',
] as const;

/**
 * The command receipts of the unit's scope (15.1.7) over the receipt table. Receipts are kept:
 * `acknowledge` stamps them and expiry is the retention worker's business. A second `put` with the
 * same fingerprint changes nothing; another fingerprint is `core.idempotency_mismatch`.
 */
export function sqlReceiptStore(ctx: SqlUnitContext): ReceiptStore {
  const table = ctx.table(commandReceiptTable);
  const read = async (commandId: string): Promise<Receipt | undefined> => {
    const row = await sqlGuard(async () =>
      ctx
        .scopedDb()
        .selectFrom(table)
        .select([...columns])
        .where('command_id', '=', commandId)
        .executeTakeFirst(),
    );
    return row === undefined ? undefined : receiptOf(row);
  };
  const valuesOf = (receipt: Receipt) => ({
    id: commandReceiptUuid(ctx.scopeId(), receipt.commandId),
    version: 1,
    created_at: encodeInstant(ctx.clock.now()),
    updated_at: encodeInstant(ctx.clock.now()),
    command_id: receipt.commandId,
    action: receipt.action,
    fingerprint: receipt.fingerprint,
    principal: receipt.principal === null ? null : JSON.stringify(receipt.principal),
    status: receipt.status,
    outcome: receipt.outcome === null ? null : JSON.stringify(receipt.outcome),
    api_version: receipt.apiVersion,
    transport: receipt.request.transport,
    remote_address: receipt.request.remoteAddress,
    user_agent: receipt.request.userAgent,
    client_id: receipt.clientId,
    client_seq: receipt.clientSeq,
    expires_at: encodeInstant(receipt.expiresAt),
    acknowledged_at:
      receipt.acknowledgedAt === undefined ? null : encodeInstant(receipt.acknowledgedAt),
  });
  /** `takeOver`: a row whose `expires_at` is at or before the clock's now is overwritten (claim). */
  const insert = (
    receipt: Receipt,
    takeOver = false,
  ): Promise<{ readonly command_id: unknown } | undefined> =>
    sqlGuard(async () => {
      const values = valuesOf(receipt);
      const { id: _id, created_at: _createdAt, ...replacement } = values;
      return ctx
        .scopedDb()
        .insertInto(table)
        .values(values)
        .onConflict((conflict) => {
          const target = conflict.columns(['scope_id', 'command_id']);
          return takeOver
            ? target
                .doUpdateSet(replacement)
                .where(
                  sql<boolean>`${sql.ref(`${commandReceiptTable}.expires_at`)} <= ${encodeInstant(ctx.clock.now())}`,
                )
            : target.doNothing();
        })
        .returning('command_id')
        .executeTakeFirst();
    });
  /**
   * The claim's insert waits for a concurrent duplicate's row lock for `claimWaitMs` and then gives
   * up with `core.command_in_progress` (section 7.5); an expired row is taken over; the unit's own setting comes back afterwards.
   */
  const insertWithin = async (
    receipt: Receipt,
  ): Promise<{ readonly command_id: unknown } | undefined> => {
    const db = ctx.db;
    const before = await sqlGuard(async () =>
      sql<{ value: string }>`select current_setting('lock_timeout') as value`.execute(db),
    );
    const previous = before.rows[0]?.value ?? '0';
    await sqlGuard(async () =>
      sql`select set_config('lock_timeout', ${`${claimWaitMs}ms`}, true)`.execute(db),
    );
    let inserted: { readonly command_id: unknown } | undefined;
    try {
      inserted = await insert(receipt, true);
    } catch (error) {
      if (sqlStateOf(error) === lockNotAvailable) {
        throw new KeelwerkError({
          kind: 'conflict',
          code: 'core.command_in_progress',
          message: 'A command with this id is still running.',
          retryable: true,
          cause: error,
        });
      }
      throw error;
    }
    await sqlGuard(async () =>
      sql`select set_config('lock_timeout', ${previous}, true)`.execute(db),
    );
    return inserted;
  };
  return {
    get: read,
    put: async (receipt) => {
      ctx.writable();
      const inserted = await insert(receipt, true);
      if (inserted !== undefined) return;
      const existing = await read(receipt.commandId);
      if (existing !== undefined && existing.fingerprint !== receipt.fingerprint) {
        throw new KeelwerkError({
          kind: 'conflict',
          code: 'core.idempotency_mismatch',
          message: 'The command id was used with a different request.',
        });
      }
    },
    claim: async (receipt) => {
      ctx.writable();
      return (await insertWithin(receipt)) === undefined ? 'exists' : 'inserted';
    },
    complete: async (commandId, outcome) => {
      ctx.writable();
      const result = await sqlGuard(async () =>
        ctx
          .scopedDb()
          .updateTable(table)
          .set({
            outcome: JSON.stringify(outcome),
            status: outcome.ok ? 'completed' : 'failed',
            version: sql`version + 1`,
            updated_at: encodeInstant(ctx.clock.now()),
          })
          .where('command_id', '=', commandId)
          .executeTakeFirst(),
      );
      if (result.numUpdatedRows === 0n)
        throw errors.not_found(`no receipt for command ${commandId}`);
    },
    forClient: async (clientId, afterSeq, limit) => {
      const rows = await sqlGuard(async () =>
        ctx
          .scopedDb()
          .selectFrom(table)
          .select([...columns])
          .where('client_id', '=', clientId)
          .where('client_seq', '>', afterSeq)
          .orderBy('client_seq', 'asc')
          .limit(limit)
          .execute(),
      );
      return rows.map(receiptOf);
    },
    acknowledge: async (clientId, uptoSeq) => {
      ctx.writable();
      await sqlGuard(async () => {
        await ctx
          .scopedDb()
          .updateTable(table)
          .set({ acknowledged_at: encodeInstant(ctx.clock.now()) })
          .where('client_id', '=', clientId)
          .where('client_seq', '<=', uptoSeq)
          .execute();
      });
    },
  };
}
