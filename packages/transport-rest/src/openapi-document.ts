import type { Artifact } from '@keelwerk/core';

/**
 * The served OpenAPI document (section 16.5.7): the file artefact at `path`
 * (`generated/openapi/{app}/{apiVersion}.json`) with `servers` rewritten to the absolute URL of
 * the request host. Undefined when there is none.
 */
export function openApiDocument(
  artifacts: readonly Artifact[],
  path: string,
  serverUrl: string,
): string | undefined {
  const file = artifacts.find((artifact) => artifact.kind === 'file' && artifact.path === path);
  if (file?.kind !== 'file') {
    return undefined;
  }
  const document: unknown = JSON.parse(file.content);
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return undefined;
  }
  return JSON.stringify({ ...document, servers: [{ url: serverUrl }] });
}
