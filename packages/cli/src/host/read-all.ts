/** Everything a readable stream delivers, as text. */
export async function readAll(stream: AsyncIterable<Uint8Array | string>): Promise<string> {
  const parts: string[] = [];
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    parts.push(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
  }
  return parts.join('');
}
