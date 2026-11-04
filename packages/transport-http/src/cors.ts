const allowedHeaders = [
  'authorization',
  'content-type',
  'idempotency-key',
  'if-match',
  'if-none-match',
  'keelwerk-client',
  'keelwerk-client-id',
  'keelwerk-version',
  'prefer',
  'traceparent',
  'x-keelwerk-backend',
  'x-keelwerk-tenant',
].join(', ');

const exposedHeaders = [
  'deprecation',
  'etag',
  'idempotent-replayed',
  'keelwerk-command-id',
  'keelwerk-effects',
  'keelwerk-version',
  'link',
  'retry-after',
  'sunset',
  'x-request-id',
].join(', ');

/** The CORS headers for an allowed origin; credentials are allowed, so the origin is echoed, never `*`. */
export function cors(origin: string, preflight: boolean): Headers {
  const headers = new Headers({
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    vary: 'Origin',
  });
  if (preflight) {
    headers.set('access-control-allow-methods', 'GET, HEAD, POST, PUT, PATCH, DELETE');
    headers.set('access-control-allow-headers', allowedHeaders);
    headers.set('access-control-max-age', '600');
  } else {
    headers.set('access-control-expose-headers', exposedHeaders);
  }
  return headers;
}
