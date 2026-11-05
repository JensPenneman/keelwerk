import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { issuesOf } from '../invoker/stages/issues-of.ts';
import type { FieldNode } from '../surface/field-node.ts';
import { fromWire } from '../wire/from-wire.ts';

/**
 * Decodes the wire form of an action's input (section 16.4.2) once, over the action's input node:
 * TypeIDs at any depth (a `patch` included) become the UUIDs the kernel stores, instants, dates and
 * wide integers are rebuilt. A value that does not decode is a `validation` error with the issues.
 */
export function decodeInput(node: FieldNode, wire: unknown): unknown {
  // An action without input (an empty shape reads as void) keeps what the transport handed over: the pipeline checks it.
  if (node.kind === 'void') return wire;
  const result = fromWire(node, wire);
  if (result.issues === undefined) return result.value;
  throw new KeelwerkError({
    kind: 'validation',
    code: 'core.validation',
    message: 'The input does not match the schema of the action.',
    issues: issuesOf(result.issues),
  });
}
