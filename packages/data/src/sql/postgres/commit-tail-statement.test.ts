import type { Hlc, NewEvent } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { pendingTailEvent } from '../pending-tail-event.ts';
import type { SqlPendingEvent } from '../sql-pending-event.ts';
import type { CommitTailEvent } from './commit-tail-event.ts';
import { commitTailStatement } from './commit-tail-statement.ts';
import { positionAfterLock } from './position-after-lock.ts';

const event = (n: number): CommitTailEvent => ({
  streamType: 'app.note',
  streamId: `00000000-0000-7000-8000-00000000000${n}`,
  streamVersion: n,
  partition: n === 1 ? null : 'p',
  eventId: `00000000-0000-7000-8000-0000000020${n}0`,
  name: 'changed',
  schemaVersion: 1,
  shapeHex: '00',
  data: '{}',
  before: null,
  meta: '{}',
  hlc: 'h',
  recordedAt: '2026-01-01T00:00:00Z',
  transient: n === 2,
  prevHash: null,
  hash: 'ab',
});

const base = { root: 'app', scopeId: 's', backendId: 'b' };

describe('commitTailStatement', () => {
  test('events: the counter, the insert and the answer in one statement, text arrays per column', () => {
    const statement = commitTailStatement({ ...base, events: [event(1), event(2)], lanes: [] });
    expect(statement.sql).toContain('insert into "app".kw_positions as p');
    expect(statement.sql).toContain('insert into "app".kw_events');
    expect(statement.sql).not.toContain('kw_job_lane_counts');
    expect(statement.sql.match(/\bwith\b/g)).toHaveLength(2);
    expect(statement.parameters.slice(0, 3)).toEqual(['s', '2', 'b']);
    expect(statement.parameters[3]).toEqual(['app.note', 'app.note']);
    expect(statement.parameters[6]).toEqual([null, 'p']);
    expect(statement.parameters.at(-3)).toEqual(['false', 'true']);
    expect(statement.parameters).toHaveLength(3 + 16);
    expect(statement.sql).toContain(
      'on conflict on constraint kw_events_scope_id_stream_type_stream_id_stream_version_key do nothing',
    );
    expect(statement.sql).toContain('returning position');
  });

  test('lanes join the same statement; without events only the lane update is sent', () => {
    const both = commitTailStatement({
      ...base,
      events: [event(1)],
      lanes: [{ laneId: '4', delta: 2 }],
    });
    expect(both.sql).toContain('update "app".kw_job_lane_counts');
    expect(both.sql).toContain('insert into "app".kw_events');
    const lanesOnly = commitTailStatement({
      ...base,
      events: [],
      lanes: [{ laneId: '4', delta: -1 }],
    });
    expect(lanesOnly.sql).not.toContain('kw_positions');
    expect(lanesOnly.parameters).toEqual(['s', ['4'], ['-1']]);
    expect(lanesOnly.sql.match(/c\.scope_id = \$1::uuid/g)).toHaveLength(2);
    expect(both.sql.match(/c\.scope_id = \$1::uuid/g)).toHaveLength(2);
  });

  test('a namespace unit passes no scope, so the lane update matches on the lane alone', () => {
    const namespaceUnit = commitTailStatement({
      ...base,
      scopeId: null,
      events: [],
      lanes: [{ laneId: '4', delta: 1 }],
    });
    expect(namespaceUnit.sql).not.toContain('scope_id');
    expect(namespaceUnit.parameters).toEqual([['4'], ['1']]);
    expect(() =>
      commitTailStatement({ ...base, scopeId: null, events: [event(1)], lanes: [] }),
    ).toThrow(TypeError);
  });

  test('nothing to write is refused, and a root that is no identifier too', () => {
    expect(() => commitTailStatement({ ...base, events: [], lanes: [] })).toThrow(TypeError);
    expect(() =>
      commitTailStatement({ ...base, root: 'a"b', events: [event(1)], lanes: [] }),
    ).toThrow(TypeError);
  });
});

describe('the stored event encoding', () => {
  const pending: SqlPendingEvent = {
    stream: { type: 'app.note', id: '00000000-0000-7000-8000-000000000001' },
    version: 3,
    partition: 'tenant-a',
    event: {
      eventId: '00000000-0000-7000-8000-000000002001',
      name: 'changed',
      schemaVersion: 4,
      shape: 'ab'.repeat(32),
      data: { title: 'x', nested: [1, null, 'é'] },
      before: { title: 'w' },
      hlc: '0000000000001-0001-node' as NewEvent['hlc'],
      recordedAt: Temporal.Instant.from('2026-01-02T03:04:05.678Z'),
      meta: {
        actor: { kind: 'user', id: '00000000-0000-7000-8000-0000000000aa', via: 'passkey' },
        commandId: '00000000-0000-7000-8000-0000000000c1',
        action: 'app.note.edit',
        causationId: null,
        correlationId: '00000000-0000-7000-8000-0000000000c2',
        client: { id: 'device-1', seq: 9 },
        merge: { lost: ['title'], winners: { body: '0000000000002-0001-node' as Hlc } },
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        writer: { build: 'b1', revision: 2 },
        flags: [{ key: 'f', variant: 'on', reason: 'rule', ruleVersion: 3 }],
        decision: {
          part: 'app.note.edit',
          inputDigest: 'cd'.repeat(32),
          input: {
            keyId: 'k1',
            nonce: Uint8Array.from([251, 255, 0, 1]),
            ciphertext: Uint8Array.from([250, 254, 62, 63, 64]),
          },
          reads: [{ at: 12_345_678_901_234_567_890n }, { scope: 'backend', at: 7n }],
          answers: [{ kind: 'id', entity: 'app.note', value: 'v' }],
          effects: ['e1'],
        },
      },
      transient: true,
      prevHash: '01'.repeat(32),
      hash: '02'.repeat(32),
    },
  };

  test('a full event is written as the golden says: a self-consistent change breaks stored rows', async () => {
    const statement = commitTailStatement({
      root: 'app',
      scopeId: '00000000-0000-7000-8000-000000000f01',
      backendId: '00000000-0000-7000-8000-000000000b01',
      events: [pendingTailEvent(pending)],
      lanes: [],
    });
    await expect(
      `${statement.parameters.map((parameter) => JSON.stringify(parameter)).join('\n')}\n`,
    ).toMatchFileSnapshot('./golden/commit-tail-parameters.txt');
    await expect(`${statement.sql}\n`).toMatchFileSnapshot('./golden/commit-tail-statement.sql');
  });
});

describe('positionAfterLock', () => {
  test('reads the counter row by scope as text in a statement of its own', () => {
    expect(positionAfterLock('app', 's')).toEqual({
      sql: 'select coalesce((select next - 1 from "app".kw_positions where scope_id = $1::uuid), 0)::text as position',
      parameters: ['s'],
    });
  });
});
