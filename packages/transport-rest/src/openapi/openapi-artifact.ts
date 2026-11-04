import type { ApiSurface, Artifact } from '@keelwerk/core';
import { emitOpenapi } from './emit-openapi.ts';
import type { OpenapiOptions } from './openapi-options.ts';
import { renderJson } from './render-json.ts';

/** The committed file of an app and API version: `generated/openapi/<app>/<version>.json` (section 13.7, S-28). */
export function openapiArtifact(surface: ApiSurface, options: OpenapiOptions = {}): Artifact {
  return {
    kind: 'file',
    path: `generated/openapi/${surface.app}/${surface.apiVersion}.json`,
    contentType: 'application/json',
    content: renderJson(emitOpenapi(surface, options)),
  };
}
