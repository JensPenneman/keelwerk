import type { FieldNode, SurfaceAction } from '@keelwerk/core';

const base = { optional: false, access: 'read-write' } as const;

/** A string field node. */
export function str(
  extra: { optional?: true; maxLength?: number; format?: 'email' | 'uri' } = {},
): FieldNode {
  return { ...base, kind: 'string', ...extra };
}

/** A non-wide integer field node. */
export function int(extra: { optional?: true; default?: number } = {}): FieldNode {
  return { ...base, kind: 'integer', wide: false, ...extra };
}

/** A read-only field node of the given simple kind. */
export function readOnly(kind: 'instant' | 'serial'): FieldNode {
  return kind === 'serial'
    ? { optional: false, access: 'read', kind, per: [] }
    : { optional: false, access: 'read', kind };
}

/** A field node of a kind without constraints. */
export function plain(kind: 'boolean' | 'instant' | 'date', optional = false): FieldNode {
  return { optional, access: 'read-write', kind };
}

/** A list field node. */
export function list(item: FieldNode, optional = false): FieldNode {
  return { optional, access: 'read-write', kind: 'list', item };
}

/** An enum field node. */
export function oneOf(...values: string[]): FieldNode {
  return { ...base, kind: 'enum', values };
}

/** An id field node of an entity. */
export function id(target: string, prefix: string, kind: 'id' | 'ref' = 'id'): FieldNode {
  return { optional: false, access: kind === 'id' ? 'read' : 'read-write', kind, target, prefix };
}

/** A shape field node. */
export function shape(
  fields: Record<string, FieldNode>,
  extra: { optional?: boolean } = {},
): FieldNode {
  return { optional: extra.optional ?? false, access: 'read-write', kind: 'shape', fields };
}

/** A field node whose value is any JSON. */
export function anyJson(optional = true): FieldNode {
  return { optional, access: 'read-write', kind: 'json', schema: {} };
}

/** The void field node. */
export const none: FieldNode = { ...base, kind: 'void' };

/** A page of a node. */
export function pageOf(item: FieldNode): FieldNode {
  return { ...base, kind: 'page', item };
}

/** An action with the defaults of a plain tenant query. */
export function action(
  ref: string,
  extra: Partial<SurfaceAction> & Pick<SurfaceAction, 'kind' | 'mount' | 'input' | 'output'>,
): SurfaceAction {
  const parts = ref.split('.');
  const entity = extra.mount === 'entity' ? parts.slice(0, 2).join('.') : undefined;
  return {
    ref,
    module: parts[0] ?? '',
    ...(entity === undefined ? {} : { entity }),
    name: parts[parts.length - 1] ?? '',
    instance: false,
    errors: [],
    auth: 'policy',
    scope: 'tenant',
    execution: 'sync',
    idempotent: false,
    offline: false,
    resumable: false,
    hints: {},
    since: '2026-11-01',
    changedIn: [],
    inputHash: 'in',
    outputHash: 'out',
    ...extra,
  };
}
