/**
 * The stream types whose transient records retention may purge (14.7.1, 15.1.10): the change
 * records of receipts. Their `created` record carries a subset of the receipt and no decision loads
 * them. A type joins this list only when a re-decide never folds its records; the records of every
 * `history: 'state'` entity of an app stay, because a re-decide folds them from version 1.
 */
export const transientPurgeTypes: readonly string[] = Object.freeze(['core.commandReceipt']);
