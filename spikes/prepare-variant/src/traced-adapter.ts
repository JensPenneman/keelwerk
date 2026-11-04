import type { DataAdapter, Unit } from '@keelwerk/core';

/** Wraps an adapter and appends to `trace` when a unit opens and closes, a command claims its receipt and a row query runs. */
export function tracedAdapter(inner: DataAdapter, trace: string[]): DataAdapter {
  const wrap = (unit: Unit): Unit => ({
    ...unit,
    rows: {
      ...unit.rows,
      find: (...args: Parameters<Unit['rows']['find']>) => {
        trace.push('find');
        return unit.rows.find(...args);
      },
    },
    receipts: {
      ...unit.receipts,
      claim: (receipt) => {
        trace.push('claim');
        return unit.receipts.claim(receipt);
      },
    },
  });
  return {
    ...inner,
    unit: (ns, scope, fn, options) => {
      trace.push(options?.readOnly === true ? 'unit:read' : 'unit:write');
      return inner.unit(
        ns,
        scope,
        async (unit) => {
          try {
            return await fn(wrap(unit));
          } finally {
            trace.push('unit:end');
          }
        },
        options,
      );
    },
  };
}
