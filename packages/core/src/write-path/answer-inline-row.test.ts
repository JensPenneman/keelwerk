import { describe, expect, test } from 'vitest';
import { buildEventMeta } from '../events/build-event-meta.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { placeholderPrincipal } from '../invoker/edge/placeholder-principal.ts';
import type { Principal } from '../principals/principal.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { Receipt } from '../storage/receipt.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { answerInlineRow } from './answer-inline-row.ts';
import type { PerformInlineInput } from './perform-inline.ts';

const t0 = Temporal.Instant.from('2026-11-19T10:00:00Z');
const commandId = 'c-1';
const effectId = 'effect-1';
const scope = { backend: null, tenant: null };

const anonymous = placeholderPrincipal({ level: 'deployment' });

const actorOf = (principal: Principal, action = 'app.probe') =>
  buildEventMeta({
    principal,
    commandId,
    action,
    correlationId: 'r',
    build: { id: 'b', revision: 1 },
    flags: [],
    decision: null,
  }).actor;

const entry = {
  ref: 'app.ping',
  module: 'app',
  input: shape({ to: field.string() }),
} as unknown as EffectEntry;

const row: StorageRow = {
  id: effectId,
  type: 'app.ping',
  commandId,
  principalResolver: null,
  principalId: null,
  createdAt: t0,
  status: 'succeeded',
  output: { ok: true },
  input: { to: 'a' },
};

const firstOf = (principal: Principal, action = 'app.probe'): StoredEvent =>
  ({ version: 1, commandId, action, actor: actorOf(principal, action) }) as unknown as StoredEvent;

function unitOf(first: StoredEvent | undefined, receipt?: Receipt): Unit {
  return {
    events: { readStream: async () => (first === undefined ? [] : [first]) },
    receipts: { get: async () => receipt },
  } as unknown as Unit;
}

const receiptOf = (over: Partial<Receipt> = {}): Receipt =>
  ({
    commandId,
    fingerprint: 'kwf1.same',
    principal: null,
    expiresAt: t0.add({ hours: 24 }),
    status: 'completed',
    ...over,
  }) as unknown as Receipt;

function performOf(
  principal: Principal,
  over: {
    readonly actions?: ReadonlyMap<string, unknown>;
    readonly commandId?: string;
    readonly action?: object;
  } = {},
): PerformInlineInput {
  return {
    run: {
      action: { ref: 'app.probe', scope: 'tenant', ...over.action },
      registry: { actions: over.actions ?? new Map() },
      principal,
      apiVersion: '2026-11-04',
      request: { transport: 'test', requestId: 'r' },
    },
    commandId: over.commandId ?? commandId,
    effectId,
    fingerprint: 'kwf1.same',
    legacyFingerprint: () => 'unused',
  } as unknown as PerformInlineInput;
}

function answer(
  caller: Principal,
  options: {
    readonly first?: StoredEvent | undefined;
    readonly receipt?: Receipt;
    readonly now?: Temporal.Instant;
    readonly actions?: ReadonlyMap<string, unknown>;
    readonly row?: StorageRow;
    readonly commandId?: string;
    readonly given?: unknown;
    readonly action?: object;
  },
) {
  return answerInlineRow({
    unit: unitOf(options.first, options.receipt),
    perform: performOf(caller, {
      ...(options.actions === undefined ? {} : { actions: options.actions }),
      ...(options.commandId === undefined ? {} : { commandId: options.commandId }),
      ...(options.action === undefined ? {} : { action: options.action }),
    }),
    entry,
    row: options.row ?? row,
    validated: options.given ?? { to: 'a' },
    submitter: undefined,
    actor: actorOf(caller),
    now: options.now ?? t0.add({ seconds: 1 }),
  }).catch((caught: unknown) => caught);
}

const mismatch = { code: 'core.idempotency_mismatch' };
const inProgress = { code: 'core.command_in_progress' };

describe('a row with no submitter answers only the actor that wrote it', () => {
  const moduleA = moduleServicePrincipal('modulea', { scope });
  const moduleB = moduleServicePrincipal('moduleb', { scope });

  test('module A is answered its own row, module B and an anonymous caller are refused', async () => {
    const first = firstOf(moduleA);
    expect(await answer(moduleA, { first })).toEqual({
      ok: true,
      value: { ok: true },
    });
    expect(await answer(moduleB, { first })).toMatchObject(mismatch);
    // Without the actor check this would be core.command_in_progress, which says the row exists.
    expect(await answer(anonymous, { first })).toMatchObject(mismatch);
  });

  test('a missing first record is a different request', async () => {
    expect(await answer(moduleA, { first: undefined })).toMatchObject(mismatch);
  });

  test('a first record of another command id or version is a different request', async () => {
    const first = firstOf(moduleA);
    expect(await answer(moduleA, { first: { ...first, commandId: 'other' } })).toMatchObject(
      mismatch,
    );
    expect(await answer(moduleA, { first: { ...first, version: 2 } })).toMatchObject(mismatch);
  });
});

describe('an anonymous caller and a row with no unexpired receipt', () => {
  const first = firstOf(anonymous);
  const probe = (timeoutMs?: number) =>
    new Map<string, unknown>([
      [
        'app.probe',
        { prepare: () => undefined, ...(timeoutMs === undefined ? {} : { timeoutMs }) },
      ],
    ]);

  test('is refused as in progress up to the timeout of its action plus the guard grace, and as a mismatch from then on', async () => {
    const actions = probe(5000);
    const at = (milliseconds: number) => t0.add({ milliseconds });
    expect(await answer(anonymous, { first, actions, now: at(64_999) })).toMatchObject(inProgress);
    expect(await answer(anonymous, { first, actions, now: at(65_000) })).toMatchObject(mismatch);
  });

  test('has no bound when the action has no timeoutMs or is unknown', async () => {
    const later = t0.add({ hours: 1 });
    expect(await answer(anonymous, { first, actions: probe(), now: later })).toMatchObject(
      inProgress,
    );
    expect(await answer(anonymous, { first, actions: new Map(), now: later })).toMatchObject(
      inProgress,
    );
  });

  test('is refused whatever it sends, so no input is confirmed', async () => {
    const same = await answer(anonymous, { first, given: { to: 'a' } });
    const other = await answer(anonymous, { first, given: { to: 'b' } });
    expect(same).toMatchObject(inProgress);
    expect(other).toMatchObject(inProgress);
    expect((same as Error).message).toBe((other as Error).message);
  });

  test('says the same past the bound whatever it sends', async () => {
    const actions = probe(5000);
    const now = t0.add({ minutes: 5 });
    const same = await answer(anonymous, { first, actions, now, given: { to: 'a' } });
    const other = await answer(anonymous, { first, actions, now, given: { to: 'b' } });
    expect(same).toMatchObject(mismatch);
    expect(other).toMatchObject(mismatch);
    expect((same as Error).message).toBe((other as Error).message);
  });

  test('is not refused under a kernel command id, which only the kernel can present', async () => {
    const kernelId = 'kernel:effect:e-1';
    const kernelFirst = { ...first, commandId: kernelId } as StoredEvent;
    const kernelRow = { ...row, commandId: kernelId };
    expect(
      await answer(anonymous, { first: kernelFirst, row: kernelRow, commandId: kernelId }),
    ).toEqual({ ok: true, value: { ok: true } });
    expect(
      await answer(anonymous, {
        first: kernelFirst,
        row: kernelRow,
        commandId: kernelId,
        given: { to: 'b' },
      }),
    ).toMatchObject(mismatch);
  });

  test('an unexpired receipt of the same request answers it, another request is refused, an expired receipt counts as none', async () => {
    expect(await answer(anonymous, { first, receipt: receiptOf() })).toEqual({
      ok: true,
      value: { ok: true },
    });
    expect(
      await answer(anonymous, { first, receipt: receiptOf({ fingerprint: 'kwf1.other' }) }),
    ).toMatchObject(mismatch);
    expect(
      await answer(anonymous, { first, receipt: receiptOf({ expiresAt: t0 }), now: t0 }),
    ).toMatchObject(inProgress);
  });

  test('with a receipt, another input is a mismatch and a requested row is in progress', async () => {
    const receipt = receiptOf();
    expect(await answer(anonymous, { first, receipt, given: { to: 'b' } })).toMatchObject(mismatch);
    expect(
      await answer(anonymous, { first, receipt, row: { ...row, status: 'requested' } }),
    ).toMatchObject(inProgress);
  });
});

describe('an anonymous caller, a finished receipt and an action that declares a credential member', () => {
  const first = firstOf(anonymous);
  const credential = { input: shape({ to: field.string(), pin: field.secret() }) };
  const plain = { input: shape({ to: field.string() }) };

  test('is refused before the effect input is compared, whatever it sends', async () => {
    const receipt = receiptOf();
    const same = await answer(anonymous, { first, receipt, action: credential });
    const other = await answer(anonymous, {
      first,
      receipt,
      action: credential,
      given: { to: 'b' },
    });
    expect(same).toMatchObject(mismatch);
    expect(other).toMatchObject(mismatch);
    expect((same as Error).message).toBe((other as Error).message);
    // The same request of an action without a credential member is answered.
    expect(await answer(anonymous, { first, receipt, action: plain })).toEqual({
      ok: true,
      value: { ok: true },
    });
  });

  test('is refused for a failed receipt as well', async () => {
    expect(
      await answer(anonymous, {
        first,
        receipt: receiptOf({ status: 'failed' }),
        action: credential,
      }),
    ).toMatchObject(mismatch);
  });

  test('is not refused by this check with a pending receipt, an expired one or none', async () => {
    const options = { first, action: credential };
    expect(
      await answer(anonymous, { ...options, receipt: receiptOf({ status: 'pending' }) }),
    ).toEqual({ ok: true, value: { ok: true } });
    expect(
      await answer(anonymous, { ...options, receipt: receiptOf({ expiresAt: t0 }), now: t0 }),
    ).toMatchObject(inProgress);
    expect(await answer(anonymous, options)).toMatchObject(inProgress);
  });

  test('is not refused under a kernel command id', async () => {
    const kernelId = 'kernel:effect:e-1';
    expect(
      await answer(anonymous, {
        first: { ...first, commandId: kernelId } as StoredEvent,
        row: { ...row, commandId: kernelId },
        commandId: kernelId,
        receipt: receiptOf({ commandId: kernelId }),
        action: credential,
      }),
    ).toEqual({ ok: true, value: { ok: true } });
  });
});
