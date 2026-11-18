const sizedTypes = ['application/json', 'application/graphql-response+json', 'text/html'];

/**
 * A complete JSON or HTML answer with its `content-length`. Yoga 5 wrote the length itself; Yoga 6
 * streams the body, which the HTTP host then frames as chunked. Event streams and multipart
 * answers pass through untouched, since they have no length.
 */
export async function sizedResponse(response: Response): Promise<Response> {
  const mediaType = (response.headers.get('content-type') ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase();
  if (
    response.body === null ||
    response.headers.has('content-length') ||
    !sizedTypes.includes(mediaType ?? '')
  ) {
    return response;
  }
  const bytes = await response.arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set('content-length', String(bytes.byteLength));
  return new Response(bytes, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
