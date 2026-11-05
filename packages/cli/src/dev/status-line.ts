import type { DevStatus } from './dev-status.ts';
import { restartTargetMs } from './restart-target.ts';
import type { TypeCheckerStatus } from './type-checker-status.ts';

function typesText(types: TypeCheckerStatus): string {
  if (types.kind === 'off') return 'types off';
  if (types.kind === 'checking') return 'types checking';
  return types.errors === 0
    ? 'types ok'
    : `types ${types.errors} error${types.errors === 1 ? '' : 's'}`;
}

function appText(status: DevStatus): string {
  if (status.app === 'running') {
    const where = [
      ...(status.port === undefined ? [] : [`http://127.0.0.1:${status.port}`]),
      ...(status.socket === undefined ? [] : [`socket ${status.socket}`]),
    ];
    return where.length === 0 ? 'app running' : `app running at ${where.join(', ')}`;
  }
  return `app ${status.app}`;
}

/** The one-line status of `keelwerk dev`: the type checker, the app and the last restart against its target. */
export function statusLine(status: DevStatus): string {
  const restart =
    status.restartMs === undefined
      ? []
      : [`restart ${status.restartMs} ms (target ${restartTargetMs} ms)`];
  return `[keelwerk] ${[typesText(status.types), appText(status), ...restart].join(' | ')}`;
}
