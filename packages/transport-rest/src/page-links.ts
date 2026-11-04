function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function linkTo(url: URL, edit: (params: URLSearchParams) => void): string {
  const next = new URL(url);
  edit(next.searchParams);
  return `<${next.pathname}${next.search}>`;
}

/**
 * The `Link` header of a page (RFC 8288, section 16.4.3): `rel="next"` from the end cursor and
 * `rel="prev"` from the start cursor, on the request's own path and query.
 */
export function pageLinks(url: URL, pageInfo: unknown): string | undefined {
  if (!isRecord(pageInfo)) {
    return undefined;
  }
  const size = url.searchParams.get('first') ?? url.searchParams.get('last');
  const links: string[] = [];
  if (pageInfo.hasNextPage === true && typeof pageInfo.endCursor === 'string') {
    const cursor = pageInfo.endCursor;
    links.push(
      `${linkTo(url, (params) => {
        params.delete('before');
        params.delete('last');
        params.set('after', cursor);
        if (size !== null) params.set('first', size);
      })}; rel="next"`,
    );
  }
  if (pageInfo.hasPreviousPage === true && typeof pageInfo.startCursor === 'string') {
    const cursor = pageInfo.startCursor;
    links.push(
      `${linkTo(url, (params) => {
        params.delete('after');
        params.delete('first');
        params.set('before', cursor);
        if (size !== null) params.set('last', size);
      })}; rel="prev"`,
    );
  }
  return links.length > 0 ? links.join(', ') : undefined;
}
