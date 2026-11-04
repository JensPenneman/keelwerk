/** Opens what `memorySeal` sealed; throws when the key, nonce or context is not the sealing one. */
export async function memoryOpen(
  material: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(material), 'AES-GCM', false, [
    'decrypt',
  ]);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(nonce), additionalData: new Uint8Array(aad) },
    key,
    new Uint8Array(ciphertext),
  );
  return new Uint8Array(plain);
}
