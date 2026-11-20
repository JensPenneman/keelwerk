import type { ApiSurface } from '@keelwerk/core';
import type { OpenAPI } from '@orpc/openapi';
import type { OpenAPIHandler } from '@orpc/openapi/fetch';
import type { RPCHandler } from '@orpc/server/fetch';
import type { OrpcContext } from '../router/orpc-context.ts';

/**
 * What the handler serves at one API version: its surface and the oRPC handlers over the router
 * built from it. `document`: oRPC's OpenAPI document of this version, built at first use (with the
 * `openapi` option only).
 */
export interface OrpcVersionMount {
  readonly surface: ApiSurface;
  readonly rpc: RPCHandler<OrpcContext>;
  readonly openapi?: OpenAPIHandler<OrpcContext>;
  readonly document?: () => Promise<OpenAPI.Document>;
}
