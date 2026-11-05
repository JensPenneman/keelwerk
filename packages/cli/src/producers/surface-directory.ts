import { join } from 'node:path';
import type { AppDerivation } from './app-derivation.ts';

/** `generated/api-surface/<app>` of an app. */
export function surfaceDirectory(app: AppDerivation): string {
  return join(app.directory, 'generated', 'api-surface', app.app.id);
}
