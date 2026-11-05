import { watch } from 'node:fs';
import { sep } from 'node:path';
import type { HostWatcher } from '../context/cli-host.ts';

/** A recursive watch of `root`; a path that cannot be reported is dropped, and a watcher
 * failure (the inotify limit, for one) goes to `onError`. */
export function watchTree(
  root: string,
  onChange: (path: string) => void,
  onError?: (message: string) => void,
): HostWatcher {
  const watcher = watch(root, { recursive: true }, (_event, name) => {
    if (name !== null) onChange(name.split(sep).join('/'));
  });
  watcher.on('error', (error) => onError?.(error.message));
  return { close: () => watcher.close() };
}
