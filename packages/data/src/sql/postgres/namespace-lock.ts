import { assertNamespaceRoot } from './assert-namespace-root.ts';
import type { PostgresStatement } from './begin-unit-statements.ts';

/** What the lock protects: applying a file, or the planner's span around several applies. */
export type NamespaceLockPurpose = 'apply' | 'migrate';

/**
 * The statement that takes a namespace's lock until the transaction ends (section 14.6.3):
 * `pg_advisory_xact_lock` on a key hashed from the purpose and the root. `apply` and `migrate`
 * are different keys, so the planner can hold `migrate` while `apply` runs.
 */
export function namespaceLock(root: string, purpose: NamespaceLockPurpose): PostgresStatement {
  return {
    sql: 'select pg_advisory_xact_lock(hashtextextended($1, 0))',
    parameters: [`keelwerk:${purpose}:${assertNamespaceRoot(root)}`],
  };
}
