/** A value as JSON text, with bigints and bytes made printable, for a test that looks for a string inside it. */
export function printedJson(value: unknown): string {
  return JSON.stringify(value, (_key, member: unknown) => {
    if (typeof member === 'bigint') return member.toString();
    return member instanceof Uint8Array ? [...member] : member;
  });
}
