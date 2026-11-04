import type { ApiSurface, FieldNode, SurfaceAction } from '@keelwerk/core';

const base = { optional: false, access: 'read-write' } as const;

export const stringNode: FieldNode = { ...base, kind: 'string' };
export const instantNode: FieldNode = { ...base, kind: 'instant' };
export const voidNode: FieldNode = { ...base, kind: 'void' };

/** A surface action with the members tests do not care about filled in. */
export function fakeAction(
  ref: string,
  overrides: Partial<SurfaceAction> & { readonly output: FieldNode },
): SurfaceAction {
  return {
    ref,
    module: ref.split('.')[0] ?? 'library',
    name: ref.split('.').at(-1) ?? ref,
    mount: 'module',
    kind: 'command',
    instance: false,
    input: voidNode,
    errors: [],
    auth: 'public',
    scope: 'tenant',
    execution: 'sync',
    idempotent: true,
    offline: false,
    resumable: false,
    hints: {},
    since: '2026-11-01',
    changedIn: [],
    inputHash: 'h',
    outputHash: 'h',
    ...overrides,
  };
}

/** A surface of the given actions. */
export function fakeSurface(actions: readonly SurfaceAction[], hash = 'sha256-test'): ApiSurface {
  return {
    format: 'keelwerk.surface/1',
    app: 'library',
    apiVersion: '2026-11-01',
    hash,
    modules: [],
    entities: [],
    actions,
    errors: [],
    events: [],
  };
}
