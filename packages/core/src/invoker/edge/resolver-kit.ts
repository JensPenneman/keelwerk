import type { Principal } from '../../principals/principal.ts';

/** What the resolvers and enrichers of one session run against: one read-only unit of the resolved scope. */
export interface ResolverKit {
  /** The values filled into an extension point of the core, in fill order, instantiated for `principal`. */
  fills(
    point: string,
    principal: Principal,
  ): readonly { readonly module: string; readonly value: unknown }[];
  /** Drives a pure generator, answering its requests in the unit with the authority of `module`. */
  drive<T>(generator: unknown, module: string, principal: Principal): Promise<T>;
}
