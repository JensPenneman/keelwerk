import { coreError } from './core-error.ts';

const jsonTypes: ReadonlySet<string> = new Set([
  'application/json',
  'application/merge-patch+json',
]);

/**
 * The JSON body of a request, or `undefined` when it is empty. Bodies above `maxBodyBytes` are
 * `core.payload_too_large` (section 16.4.11); anything but `application/json` and its merge-patch
 * alias (section 16.4.2), or text that does not parse, is `core.malformed_request`.
 */
export async function readJsonBody(request: Request, maxBodyBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBodyBytes) {
    throw coreError('core.payload_too_large');
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBodyBytes) {
    throw coreError('core.payload_too_large');
  }
  if (bytes.byteLength === 0) {
    return undefined;
  }
  const type =
    (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!jsonTypes.has(type)) {
    throw coreError('core.malformed_request', {
      message: 'The body must be application/json or application/merge-patch+json.',
    });
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw coreError('core.malformed_request', { message: 'The body is not valid JSON.' });
  }
}
