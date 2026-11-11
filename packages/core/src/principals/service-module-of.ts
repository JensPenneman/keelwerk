import { mintedServiceModules } from './minted-service-modules.ts';
import type { Principal } from './principal.ts';

/**
 * The module a service principal was minted for, or undefined for anything the kernel did not mint
 * (an object literal, a resolver's answer, a copy): such a value has no module and fails closed.
 */
export function serviceModuleOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return mintedServiceModules.get(value as Principal);
}
