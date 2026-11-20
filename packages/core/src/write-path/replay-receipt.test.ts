import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { JobCarrier } from '../invoker/job-carrier.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Receipt } from '../storage/receipt.ts';
import type { Unit } from '../storage/unit.ts';
import { replayReceipt } from './replay-receipt.ts';

const registry = { entities: new Map() } as unknown as Registry;
const unit = {} as unknown as Unit;
const output = shape({ door: field.string() });
const action = (input: object): ActionEntry =>
  ({ ref: 'x.act', module: 'x', input: shape(input as never), output }) as unknown as ActionEntry;
const failure = {
  ok: false,
  error: {
    kind: 'conflict',
    code: 'x.taken',
    message: 'Taken.',
    retryable: false,
    details: { door: 'front' },
  },
};
const receipt = (
  commandId: string,
  principal: Receipt['principal'],
  transport = 'http',
  outcome: unknown = { ok: true, value: { door: 'open' }, effects: [] },
): Receipt =>
  ({
    commandId,
    principal,
    status: outcome === failure ? 'failed' : 'completed',
    outcome,
    request: { transport, remoteAddress: null, userAgent: null },
  }) as unknown as Receipt;
const members = (error: unknown): unknown => {
  const { kind, code, message, details, retryable } = error as Record<string, unknown>;
  return { kind, code, message, details, retryable };
};
const caught = (run: Promise<unknown>): Promise<unknown> =>
  run.then(
    () => undefined,
    (error: unknown) => error,
  );
const person = { resolver: 'test.token', principalId: 'p1' };
const job = {} as unknown as JobCarrier;
const guarded = action({ pin: field.secret() });
const refused = { kind: 'conflict', code: 'core.idempotency_mismatch' };

describe('replayReceipt and a receipt without a principal reference', () => {
  test('a caller is refused, whatever the recorded outcome', async () => {
    await expect(
      replayReceipt(unit, registry, guarded, 'x', receipt('c1', null)),
    ).rejects.toMatchObject(refused);
    const completed = await caught(
      replayReceipt(unit, registry, guarded, 'x', receipt('c1', null)),
    );
    const failed = await caught(
      replayReceipt(unit, registry, guarded, 'x', receipt('c1', null, 'http', failure)),
    );
    expect(failed).toMatchObject(refused);
    expect(members(failed)).toEqual(members(completed));
  });

  test('a command id of the kernel form is replayed: no caller can present it', async () => {
    const replayed = await replayReceipt(
      unit,
      registry,
      guarded,
      'x',
      receipt('kernel:effect:e1', null),
    );
    expect(replayed).toMatchObject({ output: { door: 'open' }, replayed: true });
  });

  test("a worker's run replaying a receipt a worker's run wrote (transport 'job') is replayed", async () => {
    const replayed = await replayReceipt(
      unit,
      registry,
      guarded,
      'x',
      receipt('c1', null, 'job'),
      job,
    );
    expect(replayed).toMatchObject({ output: { door: 'open' }, replayed: true });
  });

  test("a worker's run meeting a receipt a caller wrote directly (transport 'http') is refused like the caller", async () => {
    const asJob = await caught(
      replayReceipt(unit, registry, guarded, 'x', receipt('c1', null, 'http'), job),
    );
    expect(asJob).toMatchObject(refused);
    const asCaller = await caught(
      replayReceipt(unit, registry, guarded, 'x', receipt('c1', null, 'http')),
    );
    expect(members(asJob)).toEqual(members(asCaller));
  });

  test("a caller is refused a receipt of transport 'job'", async () => {
    await expect(
      replayReceipt(unit, registry, guarded, 'x', receipt('c1', null, 'job')),
    ).rejects.toMatchObject(refused);
  });

  test('a principal reference and an action without a credential member are replayed', async () => {
    const plain = action({ note: field.string() });
    for (const [which, held] of [
      [guarded, person],
      [plain, null],
    ] as const) {
      const replayed = await replayReceipt(unit, registry, which, 'x', receipt('c1', held));
      expect(replayed.replayed).toBe(true);
    }
  });
});
