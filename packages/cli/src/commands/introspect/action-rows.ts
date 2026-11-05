import type { ApiSurface } from '@keelwerk/core';

type Row = Readonly<Record<string, unknown>>;

/** The actions of the surface, one row each. */
export function actionRows(surface: ApiSurface): readonly Row[] {
  return surface.actions.map((action) => ({
    ref: action.ref,
    kind: action.kind,
    scope: action.scope,
    auth: action.auth,
    execution: action.execution,
  }));
}
