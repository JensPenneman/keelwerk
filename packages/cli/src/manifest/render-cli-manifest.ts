import type { ApiSurface } from '@keelwerk/core';
import { canonicalizeJson } from '@keelwerk/core';
import { cliManifestOf } from './cli-manifest-of.ts';

/**
 * The text of `generated/cli/<app>/<api version>.json` (section 16.9.9, F-13): the routes, flags
 * and descriptions of the CLI for one API version, derived from the surface alone. Keys in UTF-16
 * order, two-space indentation, LF and a trailing newline, like every artefact of section 13.7.
 */
export function renderCliManifest(surface: ApiSurface): string {
  return `${JSON.stringify(JSON.parse(canonicalizeJson(cliManifestOf(surface))), null, 2)}\n`;
}
