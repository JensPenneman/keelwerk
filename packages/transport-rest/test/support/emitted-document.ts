import type { ApiSurface } from '@keelwerk/core';
import { openapiArtifact } from '../../src/openapi/openapi-artifact.ts';
import type { OpenapiOptions } from '../../src/openapi/openapi-options.ts';

/** The emitted file as text. */
export function emittedText(surface: ApiSurface, options: OpenapiOptions = {}): string {
  const artifact = openapiArtifact(surface, options);
  if (artifact.kind !== 'file') {
    throw new TypeError('the OpenAPI artefact is a file');
  }
  return artifact.content;
}

/** The emitted file parsed. */
export function emittedDocument(surface: ApiSurface, options: OpenapiOptions = {}) {
  return JSON.parse(emittedText(surface, options));
}
