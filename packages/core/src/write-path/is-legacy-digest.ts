/** Whether `text` is 64 bare lower-case hex characters: the 0.1.0 form of a stored digest. */
export function isLegacyDigest(text: string): boolean {
  return /^[0-9a-f]{64}$/.test(text);
}
