import { relative, sep } from 'node:path';

/** A path relative to the workspace root with forward slashes, as the messages name it. */
export function shownPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}
