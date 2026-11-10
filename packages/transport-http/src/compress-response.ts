import { Duplex } from 'node:stream';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';

const threshold = 1024;
const compressibleTypes: ReadonlySet<string> = new Set([
  'application/json',
  'text/html',
  'text/plain',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/xml',
  'image/svg+xml',
]);
const bodylessStatuses: ReadonlySet<number> = new Set([204, 206, 304]);

type Encoding = 'br' | 'gzip';

function compressibleType(contentType: string | null): boolean {
  if (contentType === null) return false;
  const essence = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  return (
    compressibleTypes.has(essence) ||
    (essence.startsWith('application/') && essence.endsWith('+json'))
  );
}

/** The encoding the request's `accept-encoding` selects: highest `q`, brotli on a tie; `*` counts as brotli. */
function chosenEncoding(header: string | null): Encoding | undefined {
  if (header === null) return undefined;
  const quality = new Map<string, number>();
  for (const part of header.split(',')) {
    const [name = '', ...parameters] = part.split(';');
    let q = 1;
    for (const parameter of parameters) {
      const [key = '', value = ''] = parameter.split('=');
      if (key.trim().toLowerCase() === 'q') {
        const parsed = Number.parseFloat(value.trim());
        q = Number.isNaN(parsed) ? 0 : parsed;
      }
    }
    quality.set(name.trim().toLowerCase(), q);
  }
  const brotli = quality.get('br') ?? quality.get('*') ?? 0;
  const gzip = quality.get('gzip') ?? 0;
  if (brotli > 0 && brotli >= gzip) return 'br';
  return gzip > 0 ? 'gzip' : undefined;
}

function concatenated(chunks: readonly Uint8Array[], length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/**
 * Compresses a non-streaming response by the request's `accept-encoding` (decision 274; 16.3.3):
 * brotli or gzip, for bodies over 1 KiB of a compressible type. Answers `response` itself when it
 * is not eligible. Event streams are never compressed.
 */
export async function compressResponse(response: Response, request: Request): Promise<Response> {
  const headers = response.headers;
  if (
    request.method === 'HEAD' ||
    response.body === null ||
    response.status < 200 ||
    bodylessStatuses.has(response.status) ||
    headers.has('content-encoding') ||
    headers.has('set-cookie') ||
    (headers.get('cache-control') ?? '').toLowerCase().includes('no-transform') ||
    !compressibleType(headers.get('content-type'))
  ) {
    return response;
  }
  const out = new Headers(headers);
  const varies = (headers.get('vary') ?? '').split(',').map((name) => name.trim().toLowerCase());
  if (!varies.includes('accept-encoding') && !varies.includes('*')) {
    out.append('vary', 'accept-encoding');
  }
  const encoding = chosenEncoding(request.headers.get('accept-encoding'));
  if (encoding === undefined) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: out,
    });
  }
  const reader = response.body.getReader();
  const head: Uint8Array[] = [];
  let length = 0;
  let ended = false;
  try {
    while (length <= threshold) {
      const next = await reader.read();
      if (next.done) {
        ended = true;
        break;
      }
      head.push(next.value);
      length += next.value.length;
    }
  } catch (cause) {
    // A failing source body fails the body as before, uncompressed, once the response is read.
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const buffered of head) controller.enqueue(buffered);
          controller.error(cause);
        },
      }),
      { status: response.status, statusText: response.statusText, headers: out },
    );
  }
  if (ended) {
    return new Response(concatenated(head, length), {
      status: response.status,
      statusText: response.statusText,
      headers: out,
    });
  }
  const rest = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const buffered = head.shift();
      if (buffered !== undefined) {
        controller.enqueue(buffered);
        return;
      }
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  const compressor =
    encoding === 'br'
      ? createBrotliCompress({
          params: {
            [constants.BROTLI_PARAM_QUALITY]: 4,
            [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
          },
        })
      : createGzip();
  out.set('content-encoding', encoding);
  out.delete('content-length');
  const etag = out.get('etag');
  if (etag !== null && !etag.startsWith('W/')) out.set('etag', `W/${etag}`);
  return new Response(
    rest.pipeThrough(Duplex.toWeb(compressor) as ReadableWritablePair<Uint8Array, Uint8Array>),
    { status: response.status, statusText: response.statusText, headers: out },
  );
}
