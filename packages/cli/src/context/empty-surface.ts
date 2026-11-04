import type { ApiSurface } from '@keelwerk/core';

/** The surface of a run that loaded none: no modules, no actions. */
export function emptySurface(): ApiSurface {
  return {
    format: 'keelwerk.surface/1',
    app: '',
    apiVersion: '',
    hash: '',
    modules: [],
    entities: [],
    actions: [],
    errors: [],
    events: [],
  };
}
