import { coreError } from './core-error.ts';

/**
 * The request body as bytes, never reading beyond `maxBodyBytes`: the declared `content-length` is
 * checked first, before any read, then the bytes as they arrive (the reader is cancelled at the
 * first byte over the bound). Both refuse `core.payload_too_large`. A request with no body gives
 * undefined.
 */
export async function readBoundedBody(
  request: Request,
  maxBodyBytes: number,
): Promise<Uint8Array | undefined> {
  const tooLarge = (): Error =>
    coreError('core.payload_too_large', {
      message: `The request body is larger than ${maxBodyBytes} bytes.`,
    });
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBodyBytes) throw tooLarge();
  if (request.body === null) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBodyBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
