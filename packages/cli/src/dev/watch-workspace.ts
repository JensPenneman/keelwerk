import type { CliHost, HostWatcher } from '../context/cli-host.ts';
import { debounceMs } from './debounce.ts';
import { isIgnoredChange } from './is-ignored-change.ts';

/**
 * Watches the workspace recursively and calls `onSettled` once after the changes stopped for
 * `debounceMs`, with the paths that changed (relative, `/` separators). Changes the supervisor
 * ignores never arrive.
 */
export function watchWorkspace(
  host: CliHost,
  root: string,
  onSettled: (paths: readonly string[]) => void,
  onError?: (message: string) => void,
): HostWatcher {
  let pending = new Set<string>();
  let generation = 0;
  const watcher = host.watchTree(
    root,
    (path) => {
      if (isIgnoredChange(path)) return;
      pending.add(path);
      generation += 1;
      const mine = generation;
      host.sleep(debounceMs).then(
        () => {
          if (mine !== generation || pending.size === 0) return;
          const paths = [...pending];
          pending = new Set();
          onSettled(paths);
        },
        () => undefined,
      );
    },
    onError,
  );
  return {
    close: () => {
      generation += 1;
      watcher.close();
    },
  };
}
