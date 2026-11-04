import type { Artifact } from '@keelwerk/core';

/** Bound on cached renderings: the request host is client-influenced. */
const maxRendered = 64;

/** Looks up the served OpenAPI document of a path for a request origin; undefined when there is none. */
export type OpenApiDocuments = (path: string, serverUrl: string) => string | undefined;

/**
 * The served OpenAPI documents (section 16.5.7): the file artefacts, each parsed once when this is
 * built, rendered with `servers` rewritten to the absolute URL of the request host and cached per
 * path and server URL.
 */
export function openApiDocuments(artifacts: readonly Artifact[]): OpenApiDocuments {
  const parsed = new Map<string, object>();
  for (const artifact of artifacts) {
    if (artifact.kind !== 'file') {
      continue;
    }
    const document: unknown = JSON.parse(artifact.content);
    if (typeof document === 'object' && document !== null && !Array.isArray(document)) {
      parsed.set(artifact.path, document);
    }
  }
  const rendered = new Map<string, string>();
  return (path, serverUrl) => {
    const key = `${path}\n${serverUrl}`;
    const known = rendered.get(key);
    if (known !== undefined) {
      return known;
    }
    const document = parsed.get(path);
    if (document === undefined) {
      return undefined;
    }
    const text = JSON.stringify({ ...document, servers: [{ url: serverUrl }] });
    if (rendered.size >= maxRendered) {
      rendered.clear();
    }
    rendered.set(key, text);
    return text;
  };
}
