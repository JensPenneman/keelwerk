import { pascal } from './pascal.ts';

/** `api-keys.key.revoke` becomes `apiKeysKeyRevoke` (section 16.4.1). */
export function camel(ref: string): string {
  const name = pascal(ref);
  return name.charAt(0).toLowerCase() + name.slice(1);
}
