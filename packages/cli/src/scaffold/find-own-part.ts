import type { PartPlacement } from './part-placement.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

/**
 * The file below `src/` that holds the module's own `name` in `directory` (`entities`, `actions`):
 * inside the conditional part first when the placement is one, then the plain directory.
 */
export function findOwnPart(
  request: ScaffoldRequest,
  placement: PartPlacement,
  directory: string,
  name: string,
): string | undefined {
  const candidates = [
    ...(placement.scopeDir === undefined || request.options.from !== undefined
      ? []
      : [`${placement.scopeDir}/${directory}/${name}.ts`]),
    `${directory}/${name}.ts`,
  ];
  return candidates.find((candidate) => request.files.has(candidate));
}
