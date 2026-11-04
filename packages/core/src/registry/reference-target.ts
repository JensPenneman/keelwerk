import type { AbsoluteRef, OwnRef } from '../fields/field-def.ts';

/** The module and entity a reference points at; an own reference resolves against the declaring module. */
export function referenceTarget(
  reference: AbsoluteRef | OwnRef | null,
  declaredBy: string,
): { readonly module: string; readonly entity: string } | null {
  if (reference === null) return null;
  if ('own' in reference) return { module: declaredBy, entity: reference.entity };
  return { module: reference.module, entity: reference.entity };
}
