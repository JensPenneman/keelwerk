import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineApp } from '@keelwerk/core';
import type { StandaloneModule } from './standalone-module.ts';

function isModule(value: unknown): value is object {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'kind') === 'module';
}

function listOf(module: object, key: 'optional' | 'requires'): readonly unknown[] {
  const found: unknown = Reflect.get(module, key);
  return Array.isArray(found) ? found : [];
}

/**
 * The modules of `module` itself, the partners it names as optional and, before each, the modules
 * that one requires, in an order where every module follows what it requires.
 */
function withRequirements(module: object, partners: readonly object[]): readonly object[] {
  const ordered: object[] = [];
  const visit = (candidate: object): void => {
    if (ordered.includes(candidate)) return;
    for (const required of listOf(candidate, 'requires')) {
      if (isModule(required)) visit(required);
    }
    ordered.push(candidate);
  };
  for (const partner of partners) visit(partner);
  visit(module);
  return ordered;
}

/**
 * The module a package exports from its generated `src/module.generated.ts`, composed as an app of
 * its own: alone, or with the optional modules it names together with the modules those require.
 * Empty when the package has no such file, exports no module, or (with optional modules) names
 * none. A composition that fails, by throwing or by a composition error, throws an `Error` that
 * names the package, so a producer reports it as its own failure instead of crashing.
 */
export async function composedModules(
  directory: string,
  withOptional: boolean,
): Promise<readonly StandaloneModule[]> {
  const file = join(directory, 'src', 'module.generated.ts');
  if (!existsSync(file)) return [];
  const loaded: Record<string, unknown> = await import(pathToFileURL(file).href);
  for (const name of Object.keys(loaded).toSorted()) {
    const value = loaded[name];
    if (!isModule(value)) continue;
    const id = Reflect.get(value, 'id');
    if (typeof id !== 'string') continue;
    const partners = listOf(value, 'optional').filter(isModule);
    if (withOptional && partners.length === 0) return [];
    const modules = withRequirements(value, withOptional ? partners : []);
    try {
      const app = defineApp({ id, modules: modules as never });
      const problem = app.registry.problems.find((item) => item.severity === 'error');
      if (problem !== undefined) throw new Error(`${problem.code}: ${problem.message}`);
      return [{ id, entries: [...app.registry.entities.values()] }];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const subject = withOptional ? `${id} with its optional modules` : id;
      throw new Error(`${directory}: ${subject} cannot be composed: ${message}`, { cause: error });
    }
  }
  return [];
}
