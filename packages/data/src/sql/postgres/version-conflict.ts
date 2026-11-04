import type { EntityDescriptor } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';

/** The error of a versioned update that matched no row: someone changed or removed it (15.1.8). */
export function versionConflict(entity: EntityDescriptor, id: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'conflict',
    code: 'core.version_mismatch',
    message: 'The row changed since it was read.',
    details: { entity: entity.ref, id },
  });
}
