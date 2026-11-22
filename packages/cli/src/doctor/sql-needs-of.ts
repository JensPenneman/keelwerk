import type { SqlNeedFact } from './deployment-facts.ts';

function dialectsOf(data: unknown): readonly string[] {
  if (typeof data !== 'object' || data === null) return [];
  const dialects: string[] = [];
  const sql: unknown = Reflect.get(data, 'sql');
  if (typeof sql === 'string') dialects.push(sql);
  const needs: unknown = Reflect.get(data, 'needs');
  for (const need of Array.isArray(needs) ? needs : []) {
    const dialect: unknown = typeof need === 'object' && need !== null && Reflect.get(need, 'sql');
    if (typeof dialect === 'string') dialects.push(dialect);
  }
  return dialects;
}

/**
 * The raw-SQL needs the modules of the deployment's apps declare in their module base: `data.sql`,
 * and a `{ sql }` entry of `data.needs`. One fact per app, module and dialect.
 */
export function sqlNeedsOf(apps: readonly unknown[]): readonly SqlNeedFact[] {
  const needs = new Map<string, SqlNeedFact>();
  for (const app of apps) {
    const id: unknown = Reflect.get(Object(app), 'id');
    const modules: unknown = Reflect.get(Object(app), 'modules');
    if (typeof id !== 'string' || !Array.isArray(modules)) continue;
    for (const module of modules) {
      const base: unknown = Reflect.get(Object(module), 'base');
      const moduleId: unknown = Reflect.get(Object(base), 'id');
      if (typeof moduleId !== 'string') continue;
      for (const dialect of dialectsOf(Reflect.get(Object(base), 'data'))) {
        needs.set(`${id}|${moduleId}|${dialect}`, { app: id, module: moduleId, dialect });
      }
    }
  }
  return [...needs.values()];
}
