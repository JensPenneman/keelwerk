import { field, shape } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { commandKit, runDirect, snapshot, withCommand } from './support/command-kit.ts';
import { userOf } from './support/run-read-kit.ts';

const forgedPerform = function* (): Generator<unknown, unknown, unknown> {
  const request: Record<PropertyKey, unknown> = {
    kind: 'perform',
    effect: { kind: 'external', type: 'hooks.post' },
    *[Symbol.iterator](): Generator<unknown, unknown, unknown> {
      return yield request;
    },
  };
  return yield* request as unknown as Generator<never, unknown, unknown>;
};

describe('what runCommand refuses', () => {
  test('a generated command that names no entity is internal', async () => {
    const probe = withCommand('generatedProbe', () => [], 'library.addBook', {
      generated: 'create',
    });
    const error = await runDirect({
      registry: probe.registry,
      adapter: commandKit().adapter,
      action: probe.ref,
      input: {},
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'internal', code: 'core.internal' });
  });

  test('an async command is not_implemented and stores no receipt', async () => {
    const probe = withCommand('asyncProbe', () => [], 'library.addBook', { execution: 'async' });
    const { adapter } = commandKit();
    const error = await runDirect({
      registry: probe.registry,
      adapter,
      action: probe.ref,
      input: {},
      commandId: 'a1',
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'not_implemented', code: 'core.not_implemented' });
    expect((await snapshot(adapter, undefined, 'a1')).receipt).toBeUndefined();
  });

  test('a perform request yielded in decide is internal core.effect_in_unit', async () => {
    const probe = withCommand('performInDecide', forgedPerform, 'library.addBook');
    const { adapter } = commandKit();
    const error = await runDirect({
      registry: probe.registry,
      adapter,
      action: probe.ref,
      input: {},
      commandId: 'e1',
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'internal', code: 'core.effect_in_unit' });
    expect((await snapshot(adapter, undefined, 'e1')).receipt).toBeUndefined();
  });
});

describe('the deadline reaches the unit', () => {
  test('the read-write unit opens with the signal of the command', async () => {
    const { adapter } = commandKit();
    const seen: (AbortSignal | undefined)[] = [];
    const watched = {
      ...adapter,
      unit: ((ns, scope, fn, options) => {
        seen.push(options?.signal);
        return adapter.unit(ns, scope, fn, options);
      }) as typeof adapter.unit,
    };
    const controller = new AbortController();
    await runDirect({
      adapter: watched,
      action: 'library.addBook',
      input: { title: 'Dune', isbn: 'isbn-1' },
      signal: controller.signal,
    });
    expect(seen).toEqual([controller.signal]);
  });
});

describe('replay', () => {
  const stamp = Temporal.Instant.from('2026-11-04T10:00:00Z');
  const probe = withCommand(
    'stamped',
    () => ({ events: [], result: { at: stamp, n: 7n } }),
    'library.addBook',
    {
      output: shape({ at: field.instant(), n: field.integer({ wide: true }) }),
    },
  );

  test('an output of an instant and a wide integer replays as the same values', async () => {
    const { adapter } = commandKit();
    const first = await runDirect({
      registry: probe.registry,
      adapter,
      action: probe.ref,
      input: {},
      commandId: 's1',
    });
    const again = await runDirect({
      registry: probe.registry,
      adapter,
      action: probe.ref,
      input: {},
      commandId: 's1',
    });
    expect(first.output).toEqual({ at: stamp, n: 7n });
    expect(again.replayed).toBe(true);
    expect(again.output).toEqual({ at: stamp, n: 7n });
    expect(again.output).toBeInstanceOf(Object);
    expect((again.output as { at: unknown }).at).toBeInstanceOf(Temporal.Instant);
  });

  test('another principal reusing the command id gets core.idempotency_mismatch, not the stored output', async () => {
    const { adapter } = commandKit();
    await runDirect({
      registry: probe.registry,
      adapter,
      action: probe.ref,
      input: {},
      commandId: 'k1',
      principal: { ...userOf('ada'), ref: { resolver: 'test', principalId: 'ada' } },
    });
    const error = await runDirect({
      registry: probe.registry,
      adapter,
      action: probe.ref,
      input: {},
      commandId: 'k1',
      principal: { ...userOf('grace'), ref: { resolver: 'test', principalId: 'grace' } },
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'conflict', code: 'core.idempotency_mismatch' });
  });
});
