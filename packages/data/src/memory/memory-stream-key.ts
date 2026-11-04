/** The key of a stream in the version maps. */
export function memoryStreamKey(type: string, id: string): string {
  return `${type}\u0000${id}`;
}
