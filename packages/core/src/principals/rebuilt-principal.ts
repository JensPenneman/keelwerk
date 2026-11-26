import { frozenPrincipal } from './frozen-principal.ts';
import type { Principal } from './principal.ts';

/**
 * A new principal from another one and what changes: the data is read once and checked again, and
 * the two functions of a user and a service are built again from it, never carried over.
 */
export function rebuiltPrincipal<P extends Principal>(principal: P, changes: object = {}): P {
  const {
    subjectAs: _subject,
    idAs: _id,
    ...data
  } = principal as P & {
    subjectAs?: unknown;
    idAs?: unknown;
  };
  return frozenPrincipal<P>({ ...data, ...changes } as never);
}
