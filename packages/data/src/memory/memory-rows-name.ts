/** The name of the collection that holds one scope's rows of a table (14.3.6). */
export function memoryRowsName(table: string, scopeId: string): string {
  return `rows/${table}/${scopeId}`;
}
