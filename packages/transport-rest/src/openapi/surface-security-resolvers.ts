import type { ApiSurface } from '@keelwerk/core';
import type { SecurityResolver } from './security-resolver.ts';

/** The resolvers a surface describes (`ApiSurface.resolvers`, section 8.5), in the form the security schemes take. */
export function surfaceSecurityResolvers(surface: ApiSurface): readonly SecurityResolver[] {
  return (surface.resolvers ?? []).map((resolver) => ({
    id: resolver.id,
    describe: () => ({
      scheme: resolver.scheme,
      ...(resolver.name === undefined ? {} : { name: resolver.name }),
      ...(resolver.description === undefined ? {} : { description: resolver.description }),
    }),
  }));
}
