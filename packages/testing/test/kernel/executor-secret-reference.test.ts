import type { SubjectId } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { drainHooks, effectOf, rowsOf } from './support/hooks-reads.ts';
import { watchedHooks } from './support/watched-hooks.ts';

const start = Temporal.Instant.from('2026-03-01T08:00:00Z');
const owner = crypto.randomUUID() as SubjectId;
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

describe('a secret the module loaded from its own row (D10 a, d)', () => {
  test('is handed to an effect as a reference and the executor reveals it', async () => {
    const booted = await watchedHooks(start, cleanup);
    const planted = (await booted.client.invoke('probes.plant', { owner })) as {
      readonly targetId: string;
    };
    // The row keeps the value sealed for the row, not for any effect.
    const [row] = await rowsOf(booted, 'probes.target');
    const sealedOnRow = row?.token as { keyId: string } | undefined;
    const rowKey = sealedOnRow?.keyId;
    expect(rowKey).toEqual(expect.any(String));
    await booted.client.invoke('probes.target.sign', { id: planted.targetId } as never);
    await drainHooks(booted);
    const effect = await effectOf(booted, 'probes.unseal');
    expect(effect).toMatchObject({ status: 'succeeded', output: { text: 'row-token-1' } });
    // The effect holds its own sealing of the value: a text that opens only for this effect.
    const input = effect?.input as { token: string } | undefined;
    const text = String(input?.token);
    expect(text).toMatch(/^kwv1\./);
    expect(text).not.toContain(String(rowKey));
  });
});
