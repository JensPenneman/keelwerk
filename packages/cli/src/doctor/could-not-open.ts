import type { AdapterCapabilities } from '@keelwerk/core';
import { absent } from './absent.ts';
import type { Fact } from './fact.ts';

/** What the operator can do about a placement that could not be opened. */
const fix =
  'check that the database answers at the url of the deployment file, then run doctor again';

/** The capabilities of a placement doctor could not open: the reason carries the message of what failed. */
export function couldNotOpen(message: string): Fact<AdapterCapabilities> {
  return absent(`the placement could not be opened: ${message}`, fix);
}
