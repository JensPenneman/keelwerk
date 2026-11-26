import { assertNamespaceRoot } from './assert-namespace-root.ts';
import { commandReceiptTable } from './command-receipt-table.ts';
import { selectDeletePolicies } from './select-delete-policies.ts';

/**
 * The statement of framework step 0006: on a root that has the receipt table (created by 0.2.0 with
 * a `maintenance` policy for every command) the policy is replaced by one for select and one for
 * delete, so a namespace unit can no longer insert or update a receipt row. A root that has no
 * receipt table yet is left alone: provisioning creates the table afterwards with the two policies.
 * The block drops the new names first, so that a run that finds them (a truncated history) ends in
 * the same state. Stored format: final once released, changed only by a later framework step.
 */
export function receiptMaintenanceDdl(root: string): readonly string[] {
  const table = `"${assertNamespaceRoot(root)}".${commandReceiptTable}`;
  const body = [
    `drop policy if exists maintenance on ${table}`,
    `drop policy if exists maintenance_select on ${table}`,
    `drop policy if exists maintenance_delete on ${table}`,
    ...selectDeletePolicies(table),
  ];
  return [
    `do $$ begin if to_regclass('${table}') is not null then ${body.join('; ')}; end if; end $$`,
  ];
}
