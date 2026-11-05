const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a text can be a row id (a UUID); anything else names no row and is answered as not found without asking the store. */
export function isRowId(value: string): boolean {
  return uuid.test(value);
}
