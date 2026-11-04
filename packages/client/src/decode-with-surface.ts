import type { FieldNode } from '@keelwerk/core';
import { fromWire } from '@keelwerk/core/wire';
import { clientFailure } from './client-failure.ts';

/**
 * The in-process value of a wire value, by the field node the surface gives it: instants become
 * `Temporal.Instant`, wide integers `bigint`, ids and binary are rebuilt (through `@keelwerk/core/wire`).
 * A value that does not fit its node is an `internal` error: the server and the surface disagree.
 */
export function decodeWithSurface(node: FieldNode, wire: unknown, what: string): unknown {
  const result = fromWire(node, wire);
  if (result.issues !== undefined) {
    throw clientFailure('core.internal', `The answer does not match the surface: ${what}.`, {
      issues: result.issues.map((issue) => ({
        path: (issue.path ?? []).map((segment) =>
          typeof segment === 'object' ? segment.key : segment,
        ),
        message: issue.message,
      })),
    });
  }
  return result.value;
}
