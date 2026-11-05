import { composedModules } from './composed-modules.ts';
import type { StandaloneModule } from './standalone-module.ts';

/**
 * The module of a package composed with the optional modules it names, as an app of its own, or
 * undefined when it names none. This is how the contribution and conditional tracks of a module
 * (`to-accounts`, `when-accounts`, section 14.6.1) are planned and checked although no app of the
 * workspace selects both modules.
 */
export async function pairedModule(directory: string): Promise<StandaloneModule | undefined> {
  return (await composedModules(directory, true))[0];
}
