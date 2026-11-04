/** AES-256-GCM with a fresh 96-bit nonce; `aad` binds the ciphertext to its context (14.7.4). */
export async function sqlSeal(
  material: Uint8Array,
  plain: Uint8Array,
  aad: Uint8Array,
): Promise<{ readonly nonce: Uint8Array; readonly ciphertext: Uint8Array }> {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(material), 'AES-GCM', false, [
    'encrypt',
  ]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: new Uint8Array(nonce), additionalData: new Uint8Array(aad) },
    key,
    new Uint8Array(plain),
  );
  return { nonce, ciphertext: new Uint8Array(sealed) };
}
