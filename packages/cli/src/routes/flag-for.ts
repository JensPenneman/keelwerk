import type { FieldNode } from '@keelwerk/core';
import type { FlagParameter } from './flag-parameter.ts';
import { parserFor } from './parser-for.ts';
import { valueParsers } from './value-parsers.ts';

/** Stricli's flag types depend on the value type; the kinds built here are all valid members of that union. */
function asFlag(parameter: object): FlagParameter {
  return parameter as unknown as FlagParameter;
}

function placeholderFor(node: FieldNode): string {
  switch (node.kind) {
    case 'integer':
      return node.wide ? 'bigint' : 'int';
    case 'id':
    case 'ref':
      return `${node.prefix}_id`;
    case 'instant':
      return 'rfc3339|now';
    case 'date':
      return 'yyyy-mm-dd';
    case 'text':
    case 'json':
    case 'binary':
    case 'richText':
      return 'value|@file';
    default:
      return node.kind;
  }
}

function briefOf(name: string, node: FieldNode): string {
  const kind =
    node.kind === 'list' || node.kind === 'set' ? `${node.kind} of ${node.item.kind}` : node.kind;
  return node.description ?? `${name} (${kind})`;
}

/**
 * A field node as a Stricli flag: parser, brief, optionality, variadic and enumeration (section
 * 16.9.4). Every flag is optional at this level, because `--input` may supply the field and the
 * action's schema validates the assembled input in the pipeline.
 */
export function flagFor(name: string, node: FieldNode): FlagParameter {
  const brief = briefOf(name, node);
  switch (node.kind) {
    case 'boolean':
      return asFlag({ kind: 'boolean', brief, optional: true, withNegated: false });
    case 'secret':
      return asFlag({
        kind: 'boolean',
        brief: `Read ${name} from standard input instead of prompting.`,
        optional: true,
        withNegated: false,
      });
    case 'enum':
      return asFlag({ kind: 'enum', values: node.values, brief, optional: true });
    case 'timeZone':
      return asFlag({
        kind: 'parsed',
        parse: parserFor(node),
        proposeCompletions: valueParsers.timeZoneNames,
        brief,
        placeholder: 'zone',
        optional: true,
      });
    case 'list':
    case 'set':
      return node.item.kind === 'enum'
        ? asFlag({
            kind: 'enum',
            values: node.item.values,
            brief,
            optional: true,
            variadic: true,
          })
        : asFlag({
            kind: 'parsed',
            parse: parserFor(node.item),
            brief,
            placeholder: placeholderFor(node.item),
            optional: true,
            variadic: true,
          });
    default:
      return asFlag({
        kind: 'parsed',
        parse: parserFor(node),
        brief,
        placeholder: placeholderFor(node),
        optional: true,
      });
  }
}
