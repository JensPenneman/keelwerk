import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Client } from 'pg';
import type { AppendRequest } from './append-request.ts';
import type { AppendTiming } from './append-timing.ts';
import { deterministicUuid } from './deterministic-uuid.ts';
import { namespaceRoot as ns } from './namespace-root.ts';

const backendId = deterministicUuid(3, 0, 0);
const shapeId = Buffer.from('demo.item:1');
const streamType = 'demo.item';
const columns = `id, version, count::text as count, kw_last_hash as "lastHash"`;
const counter = `(select next - 1 from ${ns}.kw_positions where scope_id = $1)::text as at`;

const sql = {
  receipt: `insert into ${ns}.core__command_receipt (tenant_id, id, command_id, action, fingerprint, status, expires_at)
            values ($1, $2, $3, 'demo.item.bump', $4, 'pending', now() + interval '24 hours')`,
  snapshot: `select next - 1 as at from ${ns}.kw_positions where scope_id = $1`,
  loadPlain: `select ${columns} from ${ns}.demo__item where tenant_id = $1 and id = $2`,
  loadPositioned: `select ${columns}, ${counter} from ${ns}.demo__item where tenant_id = $1 and id = $2`,
  targetPlain: `select ${columns} from ${ns}.demo__item where tenant_id = $1 and id = $2 for update`,
  targetPositioned: `select ${columns}, ${counter} from ${ns}.demo__item where tenant_id = $1 and id = $2 for update`,
  streamHead: `select coalesce(max(position), 0)::text as head from ${ns}.kw_events
               where scope_id = $1 and stream_type = '${streamType}' and stream_id = $2`,
  state: `update ${ns}.demo__item set version = $3, count = $4, kw_last_hlc = $5, kw_last_hash = $6
          where tenant_id = $1 and id = $2 and version = $7`,
  job: `insert into ${ns}.kw_jobs (scope_id, lane_id, queue, state, revision, input)
        values ($1, $2, 'effects', 'available', 1, $3)`,
  complete: `update ${ns}.core__command_receipt set status = 'completed', outcome = $3 where tenant_id = $1 and id = $2`,
  notify: `select pg_notify('kw_events', $1)`,
  counter: `update ${ns}.kw_positions set next = next + 1 where scope_id = $1 returning next - 1 as first`,
  event: `insert into ${ns}.kw_events (scope_id, position, backend_id, stream_type, stream_id, stream_version,
            event_id, name, shape_id, data, before, meta, hlc, recorded_at, prev_hash, hash)
          values ($1, $2, $3, '${streamType}', $4, $5, $6, 'changed', $7, $8, $9, $10, $11, $12, $13, $14)`,
  laneCount: `update ${ns}.kw_job_lane_counts set value = value + 1 where lane_id = $1 and kind = 'enqueued'`,
  tail: (withLane: boolean): string => `
    with tail as (
      update ${ns}.kw_positions set next = next + 1 where scope_id = $1 returning next - 1 as first
    )${withLane ? `, lane as (update ${ns}.kw_job_lane_counts set value = value + 1 where lane_id = $14 and kind = 'enqueued')` : ''}
    insert into ${ns}.kw_events (scope_id, position, backend_id, stream_type, stream_id, stream_version,
      event_id, name, shape_id, data, before, meta, hlc, recorded_at, prev_hash, hash)
    select $1::uuid, tail.first, $2::uuid, '${streamType}', $3::uuid, $4::integer, $5::uuid, 'changed', $6::bytea,
      $7::jsonb, $8::jsonb, $9::jsonb, $10::text, $11::timestamptz, $12::bytea, $13::bytea
    from tail returning position::text as first`,
};

interface ItemRow {
  readonly id: string;
  readonly version: number;
  readonly count: string;
  readonly lastHash: Buffer | null;
  readonly at?: string;
}

const conflict = (): Error => Object.assign(new Error('version conflict'), { code: 'kw_conflict' });

/**
 * Runs one command's unit: pending receipt, loads, the locked target, evolve and before-image, hash,
 * versioned state update, optional job, receipt completion, then the commit tail of section 15.1.4
 * (counter update, event insert, the lane's `enqueued` counter) and COMMIT. Rolls back on any error.
 */
export async function appendCommand(client: Client, request: AppendRequest): Promise<AppendTiming> {
  const started = performance.now();
  const scope = request.scope.id;
  const positioned = request.isolation === 'read committed' && request.positionedLoads;
  const loadMs: number[] = [];
  await client.query(`begin isolation level ${request.isolation}`);
  try {
    await client.query(`select set_config('keelwerk.tenant_id', $1, true)`, [scope]);
    const commandId = randomUUID();
    const receiptId = randomUUID();
    await client.query(sql.receipt, [scope, receiptId, commandId, Buffer.from(commandId)]);
    let snapshot: string | undefined;
    if (request.isolation === 'repeatable read') {
      snapshot = (await client.query<{ at: string }>(sql.snapshot, [scope])).rows[0]?.at;
    }
    const reads: { readonly id: string; readonly position: string | undefined }[] = [];
    for (const id of request.loads) {
      const loadStarted = performance.now();
      const loaded = await client.query<ItemRow>(positioned ? sql.loadPositioned : sql.loadPlain, [
        scope,
        id,
      ]);
      loadMs.push(performance.now() - loadStarted);
      reads.push({ id, position: loaded.rows[0]?.at ?? snapshot });
    }
    const sameStatement = positioned && request.targetPosition === 'same-statement';
    const target = (
      await client.query<ItemRow>(sameStatement ? sql.targetPositioned : sql.targetPlain, [
        scope,
        request.target,
      ])
    ).rows[0];
    if (target === undefined) throw new Error(`not_found: ${request.target}`);
    const targetPosition =
      positioned && !sameStatement
        ? (await client.query<{ at: string }>(sql.snapshot, [scope])).rows[0]?.at
        : (target.at ?? snapshot);
    let staleTargetPosition = false;
    if (request.auditTargetPosition && targetPosition !== undefined) {
      const head = await client.query<{ head: string }>(sql.streamHead, [scope, request.target]);
      staleTargetPosition = BigInt(head.rows[0]?.head ?? '0') > BigInt(targetPosition);
    }

    // Evolve: the generic `changed` event with an increment, its before-image and the chained hash.
    const version = target.version + 1;
    const count = BigInt(target.count) + 1n;
    const hlc = `${Date.now().toString(36)}-${commandId.slice(0, 8)}`;
    const data = JSON.stringify({ inc: { count: 1 } });
    const before = JSON.stringify({ count: target.count });
    const meta = JSON.stringify({
      actor: { kind: 'user', id: deterministicUuid(5, request.scope.index, 0), via: 'http' },
      commandId,
      action: 'demo.item.bump',
      causationId: commandId,
      correlationId: commandId,
      writer: { build: 'spike', revision: 1 },
      flags: [],
      decision: {
        part: 'decide',
        inputDigest: createHash('sha256').update(commandId).digest('base64url'),
        reads: [...reads, { id: request.target, position: targetPosition }],
        answers: [],
        effects: request.enqueueLane === undefined ? [] : [commandId],
      },
    });
    const hash = createHash('sha256')
      .update(target.lastHash ?? Buffer.alloc(0))
      .update(`${streamType}|${request.target}|${version}|changed|${data}`)
      .digest();
    const state = await client.query(sql.state, [
      scope,
      request.target,
      version,
      count.toString(),
      hlc,
      hash,
      target.version,
    ]);
    if (state.rowCount !== 1) throw conflict();
    if (request.enqueueLane !== undefined) {
      await client.query(sql.job, [scope, request.enqueueLane, JSON.stringify({ commandId })]);
    }
    await client.query(sql.complete, [
      scope,
      receiptId,
      JSON.stringify({ entity: streamType, id: request.target, version }),
    ]);
    if (request.notifyInTransaction) await client.query(sql.notify, [`${ns}:${scope}`]);

    const eventValues = [
      scope,
      backendId,
      request.target,
      version,
      randomUUID(),
      shapeId,
      data,
      before,
      meta,
      hlc,
      new Date().toISOString(),
      target.lastHash,
      hash,
    ] as const;
    const tailStarted = performance.now();
    let position: string | undefined;
    let locked: number;
    if (request.tail === 'statements') {
      position = (await client.query<{ first: string }>(sql.counter, [scope])).rows[0]?.first;
      locked = performance.now();
      const [first, ...rest] = eventValues;
      await client.query(sql.event, [first, position, ...rest]);
      if (request.enqueueLane !== undefined)
        await client.query(sql.laneCount, [request.enqueueLane]);
    } else {
      const lane = request.enqueueLane === undefined ? [] : [request.enqueueLane];
      position = (
        await client.query<{ first: string }>(sql.tail(lane.length > 0), [...eventValues, ...lane])
      ).rows[0]?.first;
      locked = performance.now();
    }
    await client.query('commit');
    const committedAt = performance.now();
    return {
      totalMs: committedAt - started,
      tailWaitMs: locked - tailStarted,
      tailHoldMs: committedAt - locked,
      loadMs,
      position: Number(position),
      staleTargetPosition,
      committedAt,
    };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}
