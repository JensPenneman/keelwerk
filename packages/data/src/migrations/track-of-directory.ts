import { trackId } from './track-id.ts';

/** The track a directory under the migrations of `module` holds; null for a name that is no track directory. */
export function trackOfDirectory(module: string, directory: string): string | null {
  if (directory === 'own') return module;
  const [head, tail, ...rest] = directory.split('.');
  if (head === undefined || rest.length > 0) return null;
  const conditions = (part: string | undefined): readonly string[] | null =>
    part?.startsWith('when-') === true ? part.slice('when-'.length).split('+') : null;
  if (head.startsWith('to-')) {
    const when = tail === undefined ? [] : conditions(tail);
    return when === null ? null : trackId(module, head.slice('to-'.length), when);
  }
  const when = conditions(head);
  return tail !== undefined || when === null ? null : trackId(module, null, when);
}
