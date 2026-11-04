import type { ApiSurface } from './api-surface.ts';
import { sortedJson } from './sorted-json.ts';

/** The text of `generated/api-surface/<app>/<api version>.json`: the surface itself, sorted keys, two-space indentation, LF, a trailing newline (section 13.7). */
export function renderSurfaceArtefact(surface: ApiSurface): string {
  return sortedJson(surface);
}
