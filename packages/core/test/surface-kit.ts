import { diffSurfaces } from '../src/api-versions/diff-surfaces.ts';
import type { ApiSurface } from '../src/surface/api-surface.ts';
import type { FieldNode } from '../src/surface/field-node.ts';
import type { SurfaceAction } from '../src/surface/surface-action.ts';

export const text = {
  kind: 'string',
  optional: false,
  access: 'read-write',
} as const satisfies FieldNode;
export const shapeOf = (fields: Record<string, FieldNode>): FieldNode => ({
  kind: 'shape',
  optional: false,
  access: 'read-write',
  fields,
});

export function actionOf(ref: string, over: Partial<SurfaceAction> = {}): SurfaceAction {
  return {
    ref,
    module: 'library',
    name: ref.split('.').at(-1) ?? ref,
    mount: 'module',
    kind: 'command',
    instance: false,
    input: shapeOf({ title: text }),
    output: shapeOf({ id: text }),
    errors: [],
    auth: 'policy',
    scope: 'tenant',
    execution: 'sync',
    idempotent: false,
    offline: false,
    resumable: false,
    hints: {},
    since: '2026-11-04',
    changedIn: [],
    inputHash: 'in',
    outputHash: 'out',
    ...over,
  };
}

export function surfaceOf(
  actions: readonly SurfaceAction[],
  over: Partial<ApiSurface> = {},
): ApiSurface {
  return {
    format: 'keelwerk.surface/1',
    app: 'library',
    apiVersion: '2026-11-04',
    hash: 'sha256-x',
    modules: [{ id: 'library', version: '1.0.0' }],
    entities: [],
    actions,
    errors: [],
    events: [],
    ...over,
  };
}

export function classes(base: SurfaceAction, head: SurfaceAction): readonly string[] {
  return diffSurfaces(surfaceOf([base]), surfaceOf([head])).map(
    (change) => `${change.kind}:${change.class}`,
  );
}

export const add = actionOf('library.add');
