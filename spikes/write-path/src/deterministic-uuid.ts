const hex = (value: number, width: number): string => value.toString(16).padStart(width, '0');

/** A UUID-shaped id derived from a kind and two indexes, so seeded data is identical on every run. */
export function deterministicUuid(kind: number, major: number, minor: number): string {
  return `${hex(kind, 8)}-0000-4000-8${hex(major, 3)}-${hex(minor, 12)}`;
}
