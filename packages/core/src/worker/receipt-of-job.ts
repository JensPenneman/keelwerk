import type { Receipt } from '../storage/receipt.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import type { Unit } from '../storage/unit.ts';

/**
 * The receipt a command job belongs to: the one of its command id when the action, the principal
 * reference and the causation agree. An accepted command's job carries its own principal reference
 * and names the receipt's command id as its cause; a job an `enqueue` effect made carries the id of
 * the command that decided it, and a caller may have named any command id for it, so a receipt of
 * another principal or another command is never the job's own (architecture 7.4).
 */
export async function receiptOfJob(
  unit: Unit,
  job: Pick<StoredJob, 'principal' | 'causation'>,
  action: string,
  commandId: string,
): Promise<Receipt | undefined> {
  if (job.causation.commandId !== commandId) return undefined;
  const receipt = await unit.receipts.get(commandId);
  if (receipt === undefined || receipt.action !== action) return undefined;
  const { principal } = receipt;
  if (
    principal === null ||
    principal.resolver !== job.principal.resolver ||
    principal.principalId !== job.principal.principalId
  ) {
    return undefined;
  }
  return receipt;
}
