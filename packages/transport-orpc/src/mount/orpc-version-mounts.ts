import {
  type ApiSurface,
  type MountContext,
  type VersionProjection,
  versionProjection,
} from '@keelwerk/core';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { RPCHandler } from '@orpc/server/fetch';
import { checkOrpcSurface } from '../check/check-orpc-surface.ts';
import { keelwerkErrorsInterceptor } from '../errors/keelwerk-errors-interceptor.ts';
import { orpcOpenapiDocument } from '../openapi/orpc-openapi-document.ts';
import type { OrpcConfig } from '../orpc-config.ts';
import type { OrpcStaticOptions } from '../orpc-static-options.ts';
import { buildOrpcRouter } from '../router/build-orpc-router.ts';
import type { OrpcContext } from '../router/orpc-context.ts';
import { orpcJsonSerializers } from '../wire/orpc-json-serializers.ts';
import type { OrpcVersionMount } from './orpc-version-mount.ts';

function mountOf(surface: ApiSurface, options: OrpcStaticOptions): OrpcVersionMount {
  const refused = checkOrpcSurface(surface)[0];
  if (refused !== undefined) {
    throw new TypeError(
      `${refused.code}: ${refused.subject}: ${refused.message} (API version ${surface.apiVersion})`,
    );
  }
  const router = buildOrpcRouter(surface);
  const interceptors = [keelwerkErrorsInterceptor];
  const rpc = new RPCHandler<OrpcContext>(router, {
    interceptors,
    ...(options.serializer === 'json' ? {} : { customJsonSerializers: orpcJsonSerializers }),
  });
  if (options.openapi === undefined) return { surface, rpc };
  let document: ReturnType<typeof orpcOpenapiDocument> | undefined;
  return {
    surface,
    rpc,
    openapi: new OpenAPIHandler<OrpcContext>(router, { interceptors }),
    document: () => {
      document ??= orpcOpenapiDocument(surface, options).catch((thrown: unknown) => {
        document = undefined;
        throw thrown;
      });
      return document;
    },
  };
}

/**
 * The oRPC mount of each API version (section 18.2): the router and the handlers over the surface
 * at that version, checked and built for every declared version at mount, so a version whose surface
 * the oRPC check refuses fails at start. A context without `surfaces` (a hand-built one) serves its
 * one surface at every version.
 */
export function orpcVersionMounts(
  ctx: MountContext<OrpcConfig>,
  options: OrpcStaticOptions,
): VersionProjection<OrpcVersionMount> {
  if (ctx.surfaces !== undefined) {
    const { surfaces } = ctx;
    const mounts = versionProjection(surfaces.versions, (version) =>
      mountOf(surfaces.at(version), options),
    );
    for (const version of mounts.versions) mounts.at(version);
    return mounts;
  }
  const head = mountOf(ctx.surface, options);
  return { versions: [ctx.surface.apiVersion], at: () => head };
}
