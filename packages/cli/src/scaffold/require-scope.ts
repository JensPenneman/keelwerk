import { usageFailure } from '../context/usage-failure.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

/** The package scope for imports of other modules, or a usage failure asking for `--scope`. */
export function requireScope(request: ScaffoldRequest): string {
  if (request.scope === undefined) {
    throw usageFailure(
      'No package scope found in the workspace: pass --scope @<scope> (for example --scope @acme).',
    );
  }
  return request.scope;
}
