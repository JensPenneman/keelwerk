import { expect, test } from 'vitest';
import { commandReceiptId } from './command-receipt-id.ts';
import { commandReceiptUuid } from './command-receipt-uuid.ts';

test('the receipt id is the TypeID of the UUID derived from the scope and the command id', () => {
  expect(commandReceiptUuid('scope-1', 'order-17')).toBe('14391f53-3c26-80b2-ae84-4a5731e4f7b3');
  expect(commandReceiptId('scope-1', 'order-17')).toBe('rcpt_0m74fn6f16g2sax12aawry9xxk');
});
