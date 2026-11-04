import type { FieldNode } from '@keelwerk/core';
import { usageFailure } from '../context/usage-failure.ts';
import type { ValueParser } from './value-parser.ts';
import { valueParsers } from './value-parsers.ts';

/** The parser of one scalar (or JSON-valued) field node, by the CLI column of section 16.2.3. */
export function parserFor(node: FieldNode): ValueParser {
  switch (node.kind) {
    case 'text':
      return valueParsers.text;
    case 'integer':
      return node.wide ? valueParsers.wideInteger : valueParsers.integer;
    case 'decimal':
      return valueParsers.decimal;
    case 'float':
      return valueParsers.float;
    case 'boolean':
      return valueParsers.boolean;
    case 'instant':
      return valueParsers.instant;
    case 'date':
      return valueParsers.date;
    case 'timeZone':
      return valueParsers.timeZone;
    case 'id':
    case 'ref':
      return valueParsers.typeId(node.prefix);
    case 'enum': {
      const values = node.values;
      return (input) => {
        if (!values.includes(input)) {
          throw usageFailure(`"${input}" is not one of: ${values.join(', ')}.`);
        }
        return input;
      };
    }
    case 'richText':
      return valueParsers.richText;
    case 'binary':
      return valueParsers.binary;
    case 'json':
    case 'foreign':
    case 'shape':
    case 'page':
    case 'list':
    case 'set':
      return valueParsers.json;
    case 'string':
    case 'subject':
    case 'secret':
    case 'serial':
    case 'blob':
    case 'void':
      return valueParsers.string;
  }
}
