/** The binding (entity, row id, field) that `encodeAad` made the associated data of a value key from; undefined for none. */
export function aadBinding(
  aad: Uint8Array | undefined,
): { readonly entity: string; readonly id: string; readonly field: string } | undefined {
  if (aad === undefined) return undefined;
  const view = new DataView(aad.buffer, aad.byteOffset, aad.byteLength);
  const parts: string[] = [];
  for (let at = 0; at < aad.byteLength; ) {
    const length = view.getUint32(at);
    parts.push(new TextDecoder().decode(aad.subarray(at + 4, at + 4 + length)));
    at += 4 + length;
  }
  const [entity, id, field] = parts;
  return entity === undefined || id === undefined || field === undefined
    ? undefined
    : { entity, id, field };
}
