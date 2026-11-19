import type { ApiSurface } from '@keelwerk/core';
import type { AnyTRPCRouter } from '@trpc/server';

/** What the handler serves at one API version: its surface and the router built from it. */
export interface TrpcVersionMount {
  readonly surface: ApiSurface;
  readonly router: AnyTRPCRouter;
}
