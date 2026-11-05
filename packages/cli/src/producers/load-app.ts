import { pathToFileURL } from 'node:url';
import type { SurfaceSource } from '@keelwerk/core';

/** The app value an app file exports, the first export (in name order) whose `kind` is `app`. */
export async function loadApp(file: string): Promise<SurfaceSource | undefined> {
  const loaded: Record<string, unknown> = await import(pathToFileURL(file).href);
  for (const name of Object.keys(loaded).toSorted()) {
    const value = loaded[name];
    if (typeof value === 'object' && value !== null && Reflect.get(value, 'kind') === 'app') {
      return value as SurfaceSource;
    }
  }
  return undefined;
}
