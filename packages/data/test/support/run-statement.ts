import { CompiledQuery } from 'kysely';
import type { PgliteUnitBase } from '../../src/pglite/index.ts';

/** One statement with positional parameters in a unit; resolves to the rows it returned and changed. */
export async function runStatement(
  unit: PgliteUnitBase,
  text: string,
  values: readonly unknown[] = [],
): Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly changed: number }> {
  const result = await unit.db.executeQuery<Record<string, unknown>>(
    CompiledQuery.raw(text, [...values]),
  );
  return { rows: result.rows, changed: Number(result.numAffectedRows ?? 0) };
}
