import type { OrpcModule } from './orpc-module.ts';
import { orpcTransport } from './orpc-transport.ts';

/** What `modules: [..., orpc]` lists. */
export const orpc: OrpcModule = orpcTransport();
