import type { DataAdapter } from '@keelwerk/core';

/**
 * What two jobs of one event see when a store runs them at once and neither has committed: no
 * receipt of the job's command (as after the receipt window) and, for the first `reads` lookups of an
 * entry by its event id (the guard of the audit reaction), no entry. The adapter a running runtime
 * holds is changed in place. The stores of the tests run one unit at a time, so a test that needs
 * both jobs past both guards has to give them this view.
 * Answers how many lookups and how many claims of a receipt it blinded.
 */
export function blindDuplicateGuards(
  adapter: DataAdapter,
  reads: number,
): { readonly lookups: () => number; readonly claims: () => number } {
  let lookups = 0;
  let claims = 0;
  const target = adapter as { unit: DataAdapter['unit'] };
  const inner = target.unit.bind(adapter);
  const asksForEvent = (entity: { readonly ref: string }, query: { readonly where?: unknown }) =>
    entity.ref === 'audit.entry' &&
    lookups < reads &&
    JSON.stringify(query.where ?? null).includes('"eventId"');
  target.unit = (namespace, scope, fn, options) =>
    inner(
      namespace,
      scope,
      (unit) =>
        fn({
          ...unit,
          receipts: {
            ...unit.receipts,
            claim: async (receipt) => {
              const claimed = await unit.receipts.claim(receipt);
              if (claimed === 'inserted' || !receipt.commandId.startsWith('kernel:reaction:')) {
                return claimed;
              }
              claims += 1;
              return 'inserted';
            },
          },
          rows: {
            ...unit.rows,
            find: async (entity, query) => {
              const page = await unit.rows.find(entity, query);
              if (!asksForEvent(entity, query)) return page;
              lookups += 1;
              return { ...page, rows: [] };
            },
            findOne: async (entity, query) => {
              const row = await unit.rows.findOne(entity, query);
              if (!asksForEvent(entity, query)) return row;
              lookups += 1;
              return undefined;
            },
          },
        }),
      options,
    );
  return { lookups: () => lookups, claims: () => claims };
}
