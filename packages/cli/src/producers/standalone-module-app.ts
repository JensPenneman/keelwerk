import { composedModules } from './composed-modules.ts';
import type { StandaloneModule } from './standalone-module.ts';

/**
 * The module a package exports from its generated `src/module.generated.ts`, composed alone as an
 * app of its own, or undefined when it has none. This is how a package whose migrations no app of
 * the workspace reaches is still checked against its snapshot.
 */
export async function standaloneModule(directory: string): Promise<StandaloneModule | undefined> {
  return (await composedModules(directory, false))[0];
}
