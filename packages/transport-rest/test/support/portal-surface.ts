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
const looseInput: FieldNode = { kind: 'shape', optional: false, access: 'read-write', fields: {} };
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

const sortKey: FieldNode = {
  kind: 'shape',
  optional: false,
  access: 'read-write',
  fields: {
    field: { kind: 'string', optional: false, access: 'read-write' },
    direction: { kind: 'enum', optional: true, access: 'read-write', values: ['asc', 'desc'] },
  },
};

/** The query members the transport tests send, over the fixture's own `limit`. */
function queryInput(input: FieldNode): FieldNode {
  if (input.kind !== 'shape') return input;
  const optional = { optional: true, access: 'read-write' } as const;
  return {
    ...input,
    fields: {
      ...input.fields,
      filter: { ...optional, kind: 'json', schema: {} },
      sort: { ...optional, kind: 'list', item: sortKey },
      first: { ...optional, kind: 'integer', wide: false },
      after: { ...optional, kind: 'string' },
      total: { ...optional, kind: 'boolean' },
      fields: {
        ...optional,
        kind: 'list',
        item: { kind: 'string', optional: false, access: 'read-write' },
      },
    },
  };
}

/** The fixture's `get` input with the field selection REST renames to `fields`. */
function getInput(input: FieldNode): FieldNode {
  if (input.kind !== 'shape') return input;
  return {
    ...input,
    fields: {
      ...input.fields,
      fields: {
        kind: 'list',
        optional: true,
        access: 'read-write',
        item: { kind: 'string', optional: false, access: 'read-write' },
      },
    },
  };
}

/** The fixture's `create` input with every member but the name optional: the tests send a name only. */
function createInput(input: FieldNode): FieldNode {
  if (input.kind !== 'shape') return input;
  return {
    ...input,
    fields: Object.fromEntries(
      Object.entries(input.fields).map(([name, node]) => [
        name,
        name === 'name' ? node : { ...node, optional: true },
      ]),
    ),
  };
}

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
      ...base.actions.map((action) => {
        switch (action.ref) {
          case `${profile}.query`:
            return { ...action, input: queryInput(action.input) };
          case `${profile}.get`:
            return { ...action, input: getInput(action.input) };
          case `${profile}.create`:
            return { ...action, input: createInput(action.input) };
          default:
            return action;
        }
      }),
      generated('update', updateInput),
      generated('archive', idInput),
      generated('restore', idInput),
      generated('set', looseInput),
      generated('changes', looseInput),
      generated('queryChanges', looseInput),
      generated('watch', looseInput, { kind: 'subscription' }),
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
