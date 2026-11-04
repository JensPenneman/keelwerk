import { commandReceipt } from '../core-module/entities/command-receipt.ts';
import { renderTypeId } from '../ids/render-type-id.ts';
import { commandReceiptUuid } from './command-receipt-uuid.ts';

/** The `rcpt_` TypeID of the receipt of a command in a scope (S-26), the id of `core.commandReceipt`. */
export function commandReceiptId(scopeId: string, commandId: string): string {
  return renderTypeId(commandReceipt.prefix, commandReceiptUuid(scopeId, commandId));
}
