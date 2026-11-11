/** Whether text is a lower-case UUID: a data subject is a row id, and the subject columns of the key tables hold one. */
export function isSubjectUuid(text: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text);
}
