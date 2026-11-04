import { compareCodePoints } from '../conditions/compare-code-points.ts';
import { coreErrorCodes } from '../errors/core-error-codes.ts';
import type { AnyErrorDefinition } from '../errors/error-definition.ts';
import type { ErrorSpec } from '../errors/error-spec.ts';
import { compositionError } from '../registry/composition-error.ts';
import type { CompositionProblem } from '../registry/composition-problem.ts';
import { schemaNodeOf } from './schema-node-of.ts';
import type { SurfaceError } from './surface-error.ts';

function retryableOf(spec: ErrorSpec): boolean {
  return spec.retryable ?? (spec.kind === 'unavailable' || spec.kind === 'rate_limited');
}

/** The errors of the surface and the problems met describing them. */
export interface SurfaceErrorsResult {
  readonly errors: readonly SurfaceError[];
  readonly problems: readonly CompositionProblem[];
}

/**
 * The errors of the surface, sorted by code (section 16.2.2): every code the core registers, the
 * declared errors of the actions, and, for a code an action lists that no definition explains, a
 * problem. A declared error's data schema becomes its node.
 */
export function surfaceErrorsOf(
  declared: ReadonlyMap<string, AnyErrorDefinition>,
  listed: readonly string[],
  prefixOf: (entityRef: string) => string | undefined,
): SurfaceErrorsResult {
  const problems: CompositionProblem[] = [];
  const byCode = new Map<string, SurfaceError>();
  for (const [code, spec] of Object.entries(coreErrorCodes)) {
    byCode.set(code, {
      code,
      kind: spec.kind,
      message: spec.message,
      retryable: retryableOf(spec),
    });
  }
  for (const [code, definition] of declared) {
    if (byCode.has(code)) continue;
    const { spec } = definition;
    let data: SurfaceError['data'];
    if (spec.data !== undefined) {
      const result = schemaNodeOf(spec.data, {
        declaredBy: code.slice(0, code.indexOf('.')),
        prefixOf,
      });
      if (result.problem !== undefined) {
        problems.push(
          compositionError('unsurfacedSchemas', `${code} data: ${result.problem}`, { ref: code }),
        );
      }
      data = result.node;
    }
    byCode.set(code, {
      code,
      kind: spec.kind,
      message: spec.message,
      retryable: retryableOf(spec),
      ...(data === undefined ? {} : { data }),
    });
  }
  for (const code of listed) {
    if (!byCode.has(code)) {
      problems.push(
        compositionError(
          'undefinedErrors',
          `An action lists the error '${code}', which no definition declares.`,
          {
            ref: code,
          },
        ),
      );
    }
  }
  return {
    errors: [...byCode.values()].sort((left, right) => compareCodePoints(left.code, right.code)),
    problems,
  };
}
