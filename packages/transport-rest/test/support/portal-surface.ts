import { readFileSync } from 'node:fs';
import type { ApiSurface, FieldNode, SurfaceAction, SurfaceError } from '@keelwerk/core';

const base = JSON.parse(
  readFileSync(new URL('../fixtures/portal-surface.json', import.meta.url), 'utf8'),
) as ApiSurface;

function find(ref: string): SurfaceAction {
  const action = base.actions.find((candidate) => candidate.ref === ref);
  if (action === undefined) {
    throw new Error(`the fixture has no action ${ref}`);
  }
  return action;
}

const profile = 'accounts.profile';
const permissive: FieldNode = { kind: 'json', optional: false, access: 'read-write', schema: {} };
const idInput: FieldNode = {
  kind: 'shape',
  optional: false,
  access: 'read-write',
  fields: {
    id: { kind: 'id', optional: false, access: 'read', target: profile, prefix: 'prof' },
    ifVersion: { kind: 'integer', wide: false, optional: true, access: 'read-write' },
  },
};

const updateInput: FieldNode = {
  kind: 'shape',
  optional: false,
  access: 'read-write',
  fields: {
    id: { kind: 'id', optional: false, access: 'read', target: profile, prefix: 'prof' },
    patch: permissive,
    ifVersion: { kind: 'integer', wide: false, optional: true, access: 'read-write' },
  },
};

function generated(
  name: string,
  input: FieldNode,
  over: Partial<SurfaceAction> = {},
): SurfaceAction {
  const create = find(`${profile}.create`);
  return {
    ...create,
    ref: `${profile}.${name}`,
    name,
    generated: name,
    instance: ['update', 'archive', 'restore'].includes(name),
    kind: ['watch', 'get', 'query', 'changes', 'queryChanges', 'history'].includes(name)
      ? 'query'
      : 'command',
    input,
    output: permissive,
    ...over,
  };
}

/** The fixture surface with a version field on the profile and every generated action of 16.5.1. */
export function portalSurface(): ApiSurface {
  const entity = base.entities.find((candidate) => candidate.ref === profile);
  if (entity === undefined) {
    throw new Error('the fixture has no profile');
  }
  const errors: SurfaceError[] = [
    ...base.errors,
    {
      code: 'core.version_mismatch',
      kind: 'conflict',
      message: 'The row changed.',
      retryable: false,
    },
  ];
  return {
    ...base,
    entities: [
      {
        ...entity,
        generated: [
          'get',
          'query',
          'create',
          'update',
          'archive',
          'restore',
          'set',
          'changes',
          'queryChanges',
          'watch',
          'history',
        ],
        fields: {
          ...entity.fields,
          version: { kind: 'integer', wide: false, optional: false, access: 'read' },
        },
      },
    ],
    actions: [
      ...base.actions,
      generated('update', updateInput),
      generated('archive', idInput),
      generated('restore', idInput),
      generated('set', permissive),
      generated('changes', permissive),
      generated('queryChanges', permissive),
      generated('watch', permissive, { kind: 'subscription' }),
      generated('history', idInput),
    ].sort((a, b) => a.ref.localeCompare(b.ref)),
    errors,
  };
}

/** Replaces one action of a surface. */
export function withAction(
  surface: ApiSurface,
  ref: string,
  over: Partial<SurfaceAction>,
): ApiSurface {
  return {
    ...surface,
    actions: surface.actions.map((action) =>
      action.ref === ref ? { ...action, ...over } : action,
    ),
  };
}
