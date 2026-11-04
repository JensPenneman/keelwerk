import type { FieldNode } from './field-node.ts';
import type { JsonSchema } from './json-schema.ts';

type Direction = 'input' | 'output';
type Schema = Record<string, unknown>;

const crockford = '[0-7][0-9a-hjkmnp-tv-z]{25}';

function scalar(node: FieldNode & { readonly kind: 'string' | 'text' }): Schema {
  return {
    type: 'string',
    ...(node.minLength === undefined ? {} : { minLength: node.minLength }),
    ...(node.maxLength === undefined ? {} : { maxLength: node.maxLength }),
    ...(node.pattern === undefined ? {} : { pattern: node.pattern }),
    ...(node.format === undefined ? {} : { format: node.format }),
  };
}

const richTextProperties = {
  codec: { type: 'string' },
  text: { type: 'string' },
  delta: {
    type: 'array',
    items: {
      type: 'object',
      properties: { insert: { type: 'string' }, attributes: { type: 'object' } },
      required: ['insert'],
    },
  },
} as const;

function richText(direction: Direction): Schema {
  if (direction === 'input') {
    return {
      anyOf: [
        { type: 'string' },
        {
          type: 'object',
          properties: {
            crdt: {
              type: 'object',
              properties: {
                codec: { type: 'string' },
                update: { type: 'string', contentEncoding: 'base64url' },
              },
              required: ['codec', 'update'],
              additionalProperties: false,
            },
          },
          required: ['crdt'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            codec: richTextProperties.codec,
            text: richTextProperties.text,
            delta: richTextProperties.delta,
          },
          required: ['codec', 'text', 'delta'],
          additionalProperties: false,
        },
      ],
    };
  }
  return {
    type: 'object',
    properties: {
      ...richTextProperties,
      version: { type: 'string', contentEncoding: 'base64url' },
    },
    required: ['codec', 'text', 'delta', 'version'],
  };
}

function shapeSchema(fields: Readonly<Record<string, FieldNode>>, direction: Direction): Schema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, member] of Object.entries(fields)) {
    if (direction === 'input' ? member.access === 'read' : member.access === 'write') {
      continue;
    }
    properties[name] = schemaOf(member, direction);
    const mayBeAbsent =
      direction === 'input' ? member.default !== undefined : member.maskable === true;
    if (!member.optional && !mayBeAbsent) {
      required.push(name);
    }
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

function kindSchema(node: FieldNode, direction: Direction): Schema {
  switch (node.kind) {
    case 'string':
    case 'text':
      return scalar(node);
    case 'integer':
      return node.wide
        ? { type: 'string', pattern: '^-?[0-9]+$' }
        : {
            type: 'integer',
            minimum: node.min ?? -Number.MAX_SAFE_INTEGER,
            maximum: node.max ?? Number.MAX_SAFE_INTEGER,
          };
    case 'decimal':
      return { type: 'string', pattern: '^-?[0-9]+(\\.[0-9]+)?$' };
    case 'float':
      return { type: 'number' };
    case 'serial':
      return { type: 'integer', minimum: 0, readOnly: true };
    case 'boolean':
      return { type: 'boolean' };
    case 'instant':
      return { type: 'string', format: 'date-time' };
    case 'date':
      return { type: 'string', format: 'date' };
    case 'timeZone':
    case 'subject':
      return { type: 'string' };
    case 'enum':
      return { type: 'string', enum: [...node.values] };
    case 'id':
    case 'ref':
      return {
        type: 'string',
        pattern: node.prefix === '' ? `^${crockford}$` : `^${node.prefix}_${crockford}$`,
      };
    case 'list':
      return { type: 'array', items: schemaOf(node.item, direction) };
    case 'set':
      return { type: 'array', items: schemaOf(node.item, direction), uniqueItems: true };
    case 'shape':
      return shapeSchema(node.fields, direction);
    case 'json':
      return { ...node.schema };
    case 'foreign':
      return { ...node[direction] };
    case 'richText':
      return richText(direction);
    case 'binary':
      return { type: 'string', contentEncoding: 'base64url' };
    case 'blob':
      return {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      };
    case 'secret':
      return { type: 'string', writeOnly: true };
    case 'void':
      return {};
    case 'page':
      return {
        type: 'object',
        properties: {
          items: { type: 'array', items: schemaOf(node.item, direction) },
          pageInfo: {
            type: 'object',
            properties: {
              hasNextPage: { type: 'boolean' },
              hasPreviousPage: { type: 'boolean' },
              startCursor: { type: ['string', 'null'] },
              endCursor: { type: ['string', 'null'] },
            },
            required: ['hasNextPage', 'hasPreviousPage', 'startCursor', 'endCursor'],
          },
          total: { type: 'integer', minimum: 0 },
          queryState: { type: 'string' },
        },
        required: ['items', 'pageInfo'],
      };
    default: {
      const unknownKind: never = node;
      throw new TypeError(`unknown field kind ${JSON.stringify(unknownKind)}`);
    }
  }
}

function schemaOf(node: FieldNode, direction: Direction): Schema {
  return {
    ...kindSchema(node, direction),
    ...(node.description === undefined ? {} : { description: node.description }),
    ...(node.default === undefined ? {} : { default: node.default }),
    ...(node.deprecated === undefined ? {} : { deprecated: true }),
    ...(node.access === 'read' && node.kind !== 'serial' ? { readOnly: true } : {}),
    ...(node.access === 'write' ? { writeOnly: true } : {}),
  };
}

/** Options of `toJsonSchema`. */
export interface ToJsonSchemaOptions {
  /** `input` (the default) describes what a client sends, `output` what it receives. */
  readonly direction?: 'input' | 'output';
}

/**
 * The JSON Schema (draft 2020-12) of a field node, by the table of section 16.2.3. Read-only
 * members leave the input schema and write-only members the output schema; optional and
 * defaulted members are not required on input.
 */
export function toJsonSchema(node: FieldNode, options: ToJsonSchemaOptions = {}): JsonSchema {
  return schemaOf(node, options.direction ?? 'input');
}
