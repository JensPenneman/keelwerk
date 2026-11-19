import type { TrpcModule } from './trpc-module.ts';
import { trpcTransport } from './trpc-transport.ts';

/** What `modules: [..., trpc]` lists. */
export const trpc: TrpcModule = trpcTransport();
