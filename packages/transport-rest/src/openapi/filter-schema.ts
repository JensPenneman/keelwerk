import {
  type ApiSurface,
  type FieldNode,
  filterOperatorsOf,
  type SurfaceEntity,
} from '@keelwerk/core';
import type { JsonObject } from './json-object.ts';
import { plainSchema } from './plain-schema.ts';
import { schemaName } from './schema-name.ts';
import { schemaRef } from './schema-ref.ts';

function operandOf(operator: string, node: FieldNode, value: JsonObject): JsonObject {
  switch (operator) {
    case 'in':
    case 'nin':
      return { type: 'array', items: value };
    case 'isNull':
      return { type: 'boolean' };
    case 'startsWith':
      return { type: 'string' };
    case 'ne':
      return { anyOf: [value, { type: 'null' }] };
    case 'contains':
      return node.kind === 'list' || node.kind === 'set'
        ? plainSchema(node.item)
        : { type: 'string' };
    default:
      return value;
  }
}

function fieldFilter(node: FieldNode, operators: readonly string[]): JsonObject {
  const value = plainSchema(node);
  const ops: JsonObject = {
    type: 'object',
    properties: Object.fromEntries(
      operators.map((operator) => [operator, operandOf(operator, node, value)]),
    ),
    additionalProperties: false,
    minProperties: 1,
  };
  const bare = operators.includes('eq') && node.personal !== true;
  return { anyOf: [...(bare ? [value] : []), { type: 'null' }, ops] };
}

/** The recursive filter schema of every entity: the condition object form of section 8.3 on the wire (sections 16.4.4 and 16.5.5). */
export function filterSchema(entity: SurfaceEntity, surface: ApiSurface): JsonObject {
  const self = schemaRef(schemaName('filter', entity.ref));
  const properties: JsonObject = {};
  for (const [name, node] of Object.entries(entity.fields)) {
    const operators = filterOperatorsOf(node);
    if (operators.length > 0) {
      properties[name] = fieldFilter(node, operators);
    }
  }
  for (const [name, relation] of Object.entries(entity.relations)) {
    if (surface.entities.some((target) => target.ref === relation.target)) {
      const target = schemaRef(schemaName('filter', relation.target));
      properties[name] = {
        type: 'object',
        properties: { some: target, none: target, every: target, is: target },
        additionalProperties: false,
      };
    }
  }
  return {
    type: 'object',
    properties: {
      ...properties,
      and: { type: 'array', items: self },
      or: { type: 'array', items: self },
      not: self,
    },
    additionalProperties: false,
  };
}
