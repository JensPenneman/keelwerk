import type { DataAdapter, Registry } from '@keelwerk/core';
import { command, effectsKit, externalEffect, registryWith } from './effects-kit.ts';
import { namespace, tenant } from './run-read-kit.ts';

export interface InlinePrepareContext {
  readonly load: {
    readonly library: { readonly book: { count(): Generator<never, number, unknown> } };
  };
  newId(entity: unknown): Generator<never, string, unknown>;
  perform(effect: unknown): Generator<never, { readonly ok: boolean }, unknown>;
  all(requests: readonly unknown[]): Generator<never, readonly unknown[], unknown>;
}

export interface InlineWriteContext {
  readonly write: {
    readonly library: { readonly book: { create(values: Record<string, unknown>): unknown } };
  };
}

export const pingDraft = {
  kind: 'external',
  type: 'library.ping',
  input: { to: 'ada@example.org' },
};

/** The attempt records of an effect, as stored. */
export function inlineAttemptsOf(adapter: DataAdapter, id: string): Promise<readonly unknown[]> {
  return adapter.unit(namespace, tenant, async (unit) =>
    (await unit.streams.read('core.effectAttempt', id, null, 100)).map((record) => record.data),
  );
}

/** Wraps an adapter: counts the units open right now and remembers whether each was read-only. */
export function countingUnits(inner: DataAdapter): {
  readonly adapter: DataAdapter;
  readonly open: () => number;
  readonly opened: boolean[];
} {
  let open = 0;
  const opened: boolean[] = [];
  return {
    open: () => open,
    opened,
    adapter: {
      ...inner,
      unit: async (ns, scope, fn, options) => {
        open += 1;
        opened.push(options?.readOnly === true);
        try {
          return await inner.unit(ns, scope, fn, options);
        } finally {
          open -= 1;
        }
      },
    },
  };
}

export interface InlineBooted {
  readonly registry: Registry;
  readonly adapter: DataAdapter;
}

export function bootInline(
  prepare: (input: unknown, ctx: InlinePrepareContext) => unknown,
  run: Parameters<typeof externalEffect>[1],
  executor: Parameters<typeof externalEffect>[2] = {},
  decide: (input: unknown, ctx: InlineWriteContext) => unknown = () => [],
  effect: Parameters<typeof externalEffect>[3] = {},
): InlineBooted & { readonly ref: string } {
  const declared = externalEffect('ping', run, { inline: true, ...executor }, effect);
  const registry = registryWith({
    effects: [declared.effect],
    executors: [declared.executor],
    actions: [command('probe', decide as never, { prepare: prepare as never })],
  });
  return { registry, adapter: effectsKit(registry).adapter, ref: 'library.probe' };
}
