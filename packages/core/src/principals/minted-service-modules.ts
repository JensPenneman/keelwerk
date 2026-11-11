import type { Principal } from './principal.ts';

/**
 * The service principals the kernel minted for a module, by object identity. `moduleServicePrincipal`
 * is the only writer; nothing else may claim to be `<module>.system`, whatever its id, `via` or
 * reference says.
 */
export const mintedServiceModules: WeakMap<Principal, string> = new WeakMap();
