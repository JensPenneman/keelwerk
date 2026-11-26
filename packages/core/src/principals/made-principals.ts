import type { Principal } from './principal.ts';

/** The principals the kernel made, held weakly: nothing else counts as one, however frozen it looks. */
export const madePrincipals: WeakSet<Principal> = new WeakSet();
