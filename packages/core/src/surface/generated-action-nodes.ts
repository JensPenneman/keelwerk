import type { GeneratedActionKind } from '../registry/generated-action-kind.ts';
import type { FieldNode } from './field-node.ts';
import type { SurfaceEntity } from './surface-entity.ts';

function scalar(kind: 'string' | 'boolean' | 'instant' | 'integer', optional = false): FieldNode {
  return kind === 'integer'
    ? { optional, access: 'read-write', kind, wide: false }
    : { optional, access: 'read-write', kind };
}

function list(item: FieldNode, optional = false): FieldNode {
  return { optional, access: 'read-write', kind: 'list', item };
}

function shapeOf(fields: Readonly<Record<string, FieldNode>>, optional = false): FieldNode {
  return { optional, access: 'read-write', kind: 'shape', fields };
}

/** A filter, in the condition AST of section 8.3; the transports substitute the entity's filter schema. */
function filter(): FieldNode {
  return { optional: true, access: 'read-write', kind: 'json', schema: {}, input: {}, output: {} };
}

/** A fixed JSON member of a result, described by its schema. */
function jsonOf(schema: Record<string, unknown>): FieldNode {
  return {
    optional: false,
    access: 'read-write',
    kind: 'json',
    schema,
    input: schema,
    output: schema,
  };
}

function idOf(entity: SurfaceEntity, optional = false): FieldNode {
  return {
    optional,
    access: 'read-write',
    kind: 'ref',
    target: entity.ref,
    prefix: entity.prefix,
  };
}

function writable(entity: SurfaceEntity, optional: boolean): Record<string, FieldNode> {
  return Object.fromEntries(
    Object.entries(entity.fields)
      .filter(([, node]) => node.access !== 'read')
      .map(([name, node]) => [name, optional ? { ...node, optional: true } : node]),
  );
}

function instance(entity: SurfaceEntity): Record<string, FieldNode> {
  return { id: idOf(entity), ifVersion: scalar('integer', true) };
}

/** The input and output nodes of one generated action. */
export interface GeneratedNodes {
  readonly input: FieldNode;
  readonly output: FieldNode;
}

/**
 * The input and output nodes of a generated action (section 6.7): the JMAP parameters and results
 * of the kind, written over the entity's fields. Every input is a `shape`, so each transport can
 * place its members (section 16.5.2).
 */
export function generatedNodes(kind: GeneratedActionKind, entity: SurfaceEntity): GeneratedNodes {
  const row = shapeOf(entity.fields);
  const ids = list(idOf(entity));
  const selection = list(scalar('string'), true);
  switch (kind) {
    case 'get':
      return {
        input: shapeOf({
          ids,
          properties: selection,
          includeArchived: scalar('boolean', true),
          ...(entity.history === 'chain' ? { asOf: scalar('instant', true) } : {}),
        }),
        output: shapeOf({
          list: list(row),
          notFound: ids,
          state: scalar('string', true),
        }),
      };
    case 'query':
      return {
        input: shapeOf({
          filter: filter(),
          sort: list(scalar('string'), true),
          first: scalar('integer', true),
          after: scalar('string', true),
          last: scalar('integer', true),
          before: scalar('string', true),
          total: scalar('boolean', true),
          includeArchived: scalar('boolean', true),
          properties: selection,
        }),
        output: { optional: false, access: 'read-write', kind: 'page', item: row },
      };
    case 'changes':
      return {
        input: shapeOf({
          since: scalar('string'),
          max: scalar('integer', true),
          partition: scalar('string', true),
        }),
        output: shapeOf({
          oldState: scalar('string'),
          newState: scalar('string'),
          hasMoreChanges: scalar('boolean'),
          created: ids,
          changed: ids,
          archived: ids,
        }),
      };
    case 'queryChanges':
      return {
        input: shapeOf({
          filter: filter(),
          sort: list(scalar('string'), true),
          sinceQueryState: scalar('string'),
          maxChanges: scalar('integer', true),
        }),
        output: shapeOf({
          oldQueryState: scalar('string'),
          newQueryState: scalar('string'),
          removed: ids,
          added: list(shapeOf({ id: idOf(entity), index: scalar('integer') })),
        }),
      };
    case 'create':
      return { input: shapeOf(writable(entity, false)), output: row };
    case 'update':
      return {
        input: shapeOf({ ...writable(entity, true), ...instance(entity) }),
        output: row,
      };
    case 'archive':
    case 'restore':
      return { input: shapeOf(instance(entity)), output: row };
    case 'set':
      return {
        input: shapeOf({
          ifInState: scalar('string', true),
          create: list(shapeOf(writable(entity, false)), true),
          update: list(
            shapeOf({ ...instance(entity), patch: shapeOf(writable(entity, true)) }),
            true,
          ),
          archive: list(shapeOf(instance(entity)), true),
          restore: list(shapeOf(instance(entity)), true),
        }),
        output: shapeOf({
          oldState: scalar('string'),
          newState: scalar('string'),
          created: ids,
          updated: ids,
          archived: ids,
          restored: ids,
          failed: list(
            shapeOf({
              operation: scalar('string'),
              id: scalar('string', true),
              code: scalar('string'),
              message: scalar('string'),
            }),
          ),
        }),
      };
    case 'watch':
      return {
        input: shapeOf({ filter: filter(), since: scalar('string', true) }),
        output: row,
      };
    case 'history':
      return {
        input: shapeOf({
          id: idOf(entity),
          asOf: scalar('instant', true),
          fromVersion: scalar('integer', true),
          limit: scalar('integer', true),
        }),
        output: shapeOf({
          entries: list(
            shapeOf({
              version: scalar('integer'),
              at: scalar('instant'),
              event: scalar('string'),
              actor: jsonOf({
                type: 'object',
                properties: {
                  kind: { type: 'string' },
                  id: { type: ['string', 'null'] },
                  via: { type: 'string' },
                },
                required: ['kind', 'id', 'via'],
                additionalProperties: false,
              }),
              changes: jsonOf({
                type: 'object',
                additionalProperties: {
                  type: 'object',
                  properties: { before: {}, after: {} },
                  required: ['before'],
                  additionalProperties: false,
                },
              }),
            }),
          ),
        }),
      };
    default: {
      const unknownKind: never = kind;
      throw new TypeError(`unknown generated action ${String(unknownKind)}`);
    }
  }
}
