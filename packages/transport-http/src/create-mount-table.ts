import { KeelwerkError, type TransportProblem } from '@keelwerk/core';
import type { Mount, MountTable } from './mount-table.ts';

function routeConflict(transport: string, prefix: string, message: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'internal',
    code: 'core.internal',
    message: `routeConflict: ${message}`,
    details: {
      code: 'routeConflict',
      transport,
      subject: prefix,
      message,
    } satisfies TransportProblem,
  });
}

function normalize(transport: string, prefix: string): string {
  if (!prefix.startsWith('/')) {
    throw routeConflict(transport, prefix, `the prefix '${prefix}' must start with '/'.`);
  }
  return prefix.length > 1 ? prefix.replace(/\/+$/, '') : '/';
}

function covers(prefix: string, path: string): boolean {
  return prefix === '/' || path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Builds the table of one app (section 16.3.3). `/_keelwerk` belongs to the framework, `/` may be
 * a user interface that every other prefix sits beside, and any other prefix that equals or nests
 * with one of the app's is a `routeConflict`.
 */
export function createMountTable(app: string): MountTable {
  const mounts: Mount[] = [];
  return {
    add(spec, handler) {
      const prefix = normalize(spec.transport, spec.prefix);
      if (prefix === '/_keelwerk' || prefix.startsWith('/_keelwerk/')) {
        throw routeConflict(
          spec.transport,
          prefix,
          `'${prefix}' of transport '${spec.transport}' is under the reserved prefix '/_keelwerk' (app '${app}').`,
        );
      }
      const clash = mounts.find(
        (mount) =>
          mount.prefix === prefix ||
          (mount.prefix !== '/' &&
            prefix !== '/' &&
            (covers(mount.prefix, prefix) || covers(prefix, mount.prefix))),
      );
      if (clash !== undefined) {
        throw routeConflict(
          spec.transport,
          prefix,
          `'${prefix}' of transport '${spec.transport}' overlaps '${clash.prefix}' of transport '${clash.transport}' (app '${app}').`,
        );
      }
      mounts.push({ transport: spec.transport, prefix, handler });
    },
    match(path) {
      let best: Mount | undefined;
      for (const mount of mounts) {
        if (
          covers(mount.prefix, path) &&
          (best === undefined || mount.prefix.length > best.prefix.length)
        ) {
          best = mount;
        }
      }
      return best;
    },
  };
}
