import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EntityEntry } from '@keelwerk/core';
import { defineApp } from '@keelwerk/core';

/** What a module package describes when it stands alone: its id and the entities of an app of it. */
export interface StandaloneModule {
  readonly id: string;
  readonly entries: readonly EntityEntry[];
}

/**
 * The module a package exports from its generated `src/module.generated.ts`, composed alone as an
 * app, or undefined when the package has no such file or exports no module. This is how a module
 * package whose migrations no app of the workspace reaches is still checked against its snapshot.
 */
export async function standaloneModule(directory: string): Promise<StandaloneModule | undefined> {
  const file = join(directory, 'src', 'module.generated.ts');
  if (!existsSync(file)) return undefined;
  const loaded: Record<string, unknown> = await import(pathToFileURL(file).href);
  for (const name of Object.keys(loaded).toSorted()) {
    const value = loaded[name];
    if (typeof value === 'object' && value !== null && Reflect.get(value, 'kind') === 'module') {
      const id = Reflect.get(value, 'id');
      if (typeof id !== 'string') continue;
      const app = defineApp({ id, modules: [value] as never });
      return { id, entries: [...app.registry.entities.values()] };
    }
  }
  return undefined;
}
