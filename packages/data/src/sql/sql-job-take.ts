import type { StoredJob } from '@keelwerk/core';
import { admitGroupJob } from './admit-group-job.ts';
import { encodeInstant } from './encode-instant.ts';
import { groupKeyOfJob } from './group-key-of-job.ts';
import { groupRowMissing } from './group-row-missing.ts';
import { jobUnitScopeId } from './job-unit-scope-id.ts';
import type { LaneTake } from './postgres/advance-lanes-statement.ts';
import { advanceLanesStatement } from './postgres/advance-lanes-statement.ts';
import { fairTakeStatement } from './postgres/fair-take-statement.ts';
import type { GroupRowKey } from './postgres/lock-groups-statement.ts';
import { lockGroupsStatement } from './postgres/lock-groups-statement.ts';
import { markRunningStatement } from './postgres/mark-running-statement.ts';
import { takeBoundsStatement } from './postgres/take-bounds-statement.ts';
import { writeGroupStatement } from './postgres/write-group-statement.ts';
import type { SqlRow } from './run-sql.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import { sqlGroupOfRow } from './sql-group-of-row.ts';
import type { SqlGroupState } from './sql-group-state.ts';
import { sqlJobReclaim } from './sql-job-reclaim.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';
import { storedJobOfRow } from './stored-job-of-row.ts';

const groupMapKey = (key: GroupRowKey): string => `${key.id}\u0000${key.scopeId ?? ''}`;

function groupOf(row: SqlRow): GroupRowKey | undefined {
  return groupKeyOfJob(
    row.group_id === null ? null : String(row.group_id),
    groupScopeOf(row.group_spec),
    String(row.scope_id),
  );
}

function groupScopeOf(spec: unknown): unknown {
  const parsed = typeof spec === 'string' ? (JSON.parse(spec) as unknown) : spec;
  return typeof parsed === 'object' && parsed !== null && 'scope' in parsed
    ? parsed.scope
    : undefined;
}

/** The group rows of the picked jobs, locked in one id-ordered pass; a row another unit holds is left out. */
async function lockedGroups(
  ctx: SqlUnitContext,
  rows: readonly SqlRow[],
): Promise<{ readonly groups: Map<string, SqlGroupState>; readonly held: ReadonlySet<string> }> {
  const keys = new Map<string, GroupRowKey>();
  for (const row of rows) {
    const key = groupOf(row);
    if (key !== undefined) keys.set(groupMapKey(key), key);
  }
  const groups = new Map<string, SqlGroupState>();
  const held = new Set<string>();
  if (keys.size === 0) return { groups, held };
  const answered = await runSql(
    ctx.db,
    lockGroupsStatement(ctx.namespace.root, [...keys.values()]),
  );
  for (const row of answered) {
    const key = groupMapKey({
      id: String(row.id),
      scopeId: row.scope_id === null ? null : String(row.scope_id),
    });
    if (row.present !== true) throw groupRowMissing(String(row.id));
    if (row.locked === true) groups.set(key, sqlGroupOfRow(row));
    else held.add(key);
  }
  return { groups, held };
}

/** What a worker asks of a take (14.3.9). */
export interface SqlTakeRequest {
  readonly limit: number;
  readonly lanes?: number;
  readonly capabilitySets: readonly string[];
  readonly maxRevision: number;
  readonly leaseMs: number;
}

/**
 * The fair take (9.5.3, 14.3.9) in the take's unit, which waits for no lock another unit holds:
 * expired leases are reclaimed where the take got every lock the reclaim needs (`sqlJobReclaim`),
 * `$vmin` is read, the take statement locks lanes and then jobs with `skip locked`, the groups of the
 * jobs picked are locked in id order, also without waiting, and checked (a job over its limit stays
 * `available`; a job whose group row another unit holds stays `available` and its lane counts as
 * skipped), and the admitted jobs become `running` with the worker, the next attempt and a lease
 * while their lanes add them to `taken` and their cost to the virtual time. `skippedLanes` counts
 * the lanes that were eligible and within the lane budget but locked by another taker and the lanes
 * a job of which stayed because its group row is held, apart from "no work". A lane in which only a
 * reclaim, a promotion or a release of a successor was left behind a held row is not counted: the
 * next take of the queue does that work. The unit buffers no lane change, so its commit runs no tail
 * statement for the take.
 */
export async function sqlJobTake(
  ctx: SqlUnitContext,
  buffer: SqlCommitBuffer,
  queue: string,
  worker: string,
  request: SqlTakeRequest,
): Promise<{ readonly jobs: readonly StoredJob[]; readonly skippedLanes: number }> {
  const root = ctx.namespace.root;
  const now = ctx.clock.now();
  const nowText = encodeInstant(now);
  const scopeId = jobUnitScopeId(ctx);
  await sqlJobReclaim(ctx, buffer, queue, now);
  const heldLanes = new Set<string>();
  const [bounds] = await runSql(
    ctx.db,
    takeBoundsStatement(root, queue, request.capabilitySets, scopeId),
  );
  const eligible = Number(bounds?.eligible ?? 0);
  if (eligible === 0) return { jobs: [], skippedLanes: 0 };
  const vmin = Number(bounds?.vmin ?? 0);
  const lanesWanted = request.lanes ?? request.limit;
  const picked = await runSql(
    ctx.db,
    fairTakeStatement({
      root,
      queue,
      capabilitySets: request.capabilitySets,
      vmin,
      lanes: lanesWanted,
      batch: request.limit,
      maxRevision: request.maxRevision,
      now: nowText,
      scopeId,
    }),
  );
  const lockedLanes = new Set(picked.map((row) => String(row.lane_id)));
  const candidates = picked.filter((row) => row.id !== null);
  const { groups, held } = await lockedGroups(ctx, candidates);
  const touched = new Set<string>();
  const admitted: SqlRow[] = [];
  for (const row of candidates) {
    if (admitted.length >= request.limit) break;
    const key = groupOf(row);
    if (key !== undefined && held.has(groupMapKey(key))) {
      heldLanes.add(String(row.lane_id));
      continue;
    }
    const state = key === undefined ? undefined : groups.get(groupMapKey(key));
    if (state !== undefined) {
      const decision = admitGroupJob(state, now);
      if (decision.group !== state) {
        groups.set(groupMapKey(state), decision.group);
        touched.add(groupMapKey(state));
      }
      if (!decision.admitted) continue;
    }
    admitted.push(row);
  }
  for (const key of touched) {
    const group = groups.get(key);
    if (group === undefined) continue;
    await runSql(
      ctx.db,
      writeGroupStatement(root, {
        id: group.id,
        scopeId: group.scopeId,
        running: group.running,
        tokens: group.rate === null ? null : group.tokens,
        refilledAt: group.refilledAt === null ? null : encodeInstant(group.refilledAt),
        blockedUntil: group.blockedUntil === null ? null : encodeInstant(group.blockedUntil),
      }),
    );
  }
  const skippedLanes =
    Math.max(0, Math.min(eligible, lanesWanted) - lockedLanes.size) + heldLanes.size;
  if (admitted.length === 0) return { jobs: [], skippedLanes };
  await runSql(
    ctx.db,
    markRunningStatement(
      root,
      worker,
      encodeInstant(now.add({ milliseconds: request.leaseMs })),
      nowText,
      admitted.map((row) => String(row.id)),
    ),
  );
  const perLane = new Map<string, { jobs: number; cost: number }>();
  for (const row of admitted) {
    const lane = perLane.get(String(row.lane_id)) ?? { jobs: 0, cost: 0 };
    perLane.set(String(row.lane_id), { jobs: lane.jobs + 1, cost: lane.cost + Number(row.cost) });
  }
  const laneTakes: LaneTake[] = [...perLane].map(([laneId, take]) => ({ laneId, ...take }));
  await runSql(ctx.db, advanceLanesStatement(root, vmin, laneTakes));
  return { jobs: admitted.map(storedJobOfRow), skippedLanes };
}
