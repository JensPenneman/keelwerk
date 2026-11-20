import type { ApiSurface } from '@keelwerk/core';
import { type OpenAPI, OpenAPIGenerator } from '@orpc/openapi';
import type { OrpcStaticOptions } from '../orpc-static-options.ts';
import { buildOrpcRouter } from '../router/build-orpc-router.ts';
import { orpcSchemaConverter } from './orpc-schema-converter.ts';

/**
 * The OpenAPI document oRPC's generator writes for the router of one API version's surface: one
 * operation per procedure, `POST /<module>/<action>`, with the schemas of the surface's field nodes.
 * The server entry is the mount of the OpenAPI handler (`openapi`), or `/orpc-openapi` without one.
 */
export async function orpcOpenapiDocument(
  surface: ApiSurface,
  options: OrpcStaticOptions = {},
): Promise<OpenAPI.Document> {
  return await new OpenAPIGenerator({ schemaConverters: [orpcSchemaConverter] }).generate(
    buildOrpcRouter(surface),
    {
      info: { title: surface.app, version: surface.hash },
      servers: [{ url: options.openapi ?? '/orpc-openapi' }],
    },
  );
}
