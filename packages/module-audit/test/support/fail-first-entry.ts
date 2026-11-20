import { type DataAdapter, errors } from '@keelwerk/core';

/**
 * Makes the first insert of a row of `audit.entry` fail with a retryable error, once, in the
 * adapter a running runtime holds (changed in place). Answers how many inserts it refused.
 */
export function failFirstEntry(adapter: DataAdapter): { readonly refused: () => number } {
  let refused = 0;
  const target = adapter as { unit: DataAdapter['unit'] };
  const inner = target.unit.bind(adapter);
  target.unit = (namespace, scope, fn, options) =>
    inner(
      namespace,
      scope,
      (unit) =>
        fn({
          ...unit,
          rows: {
            ...unit.rows,
            insert: (entity, rows) => {
              if (entity.ref === 'audit.entry' && refused === 0) {
                refused += 1;
                return Promise.reject(errors.unavailable('the store is busy, try again'));
              }
              return unit.rows.insert(entity, rows);
            },
          },
        }),
      options,
    );
  return { refused: () => refused };
}
