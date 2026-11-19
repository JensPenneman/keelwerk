import { assertNamespaceRoot } from './assert-namespace-root.ts';
import { assertRoleName } from './assert-role-name.ts';

/** The grant of framework step 0004: the application role may execute `kw_purge_transient`, and nothing else on `kw_events` beyond the `select` and `insert` it already has. */
export function transientPurgeRoleDdl(root: string, role: string): readonly string[] {
  const schema = assertNamespaceRoot(root);
  const name = assertRoleName(role);
  return [
    `grant execute on function "${schema}".kw_purge_transient(timestamptz, integer, text[]) to "${name}"`,
  ];
}
