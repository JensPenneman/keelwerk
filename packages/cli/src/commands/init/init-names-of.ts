import { basename, resolve } from 'node:path';
import { usageFailure } from '../../context/usage-failure.ts';
import type { InitNames } from '../../init/init-names.ts';
import { isModuleId } from '../../scaffold/is-module-id.ts';
import type { InitFlags } from './init-flags.ts';

const reserved = new Set(['core', 'app']);

function kebabOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[0-9]+/, '');
}

function idOf(flag: string, value: string | undefined, fallback: string): string {
  const id = value ?? fallback;
  if (!isModuleId(id) || reserved.has(id)) {
    throw usageFailure(
      `${flag} takes a kebab-case id other than core and app, not "${id}"; pass ${flag} explicitly.`,
    );
  }
  return id;
}

/** The names of the project `init` creates in `directory`, checked: ids are kebab-case and the scope looks like @acme. */
export function initNamesOf(directory: string, flags: InitFlags): InitNames {
  const project = kebabOf(basename(resolve(directory)));
  const scope = flags.scope ?? `@${project}`;
  if (!/^@[a-z0-9-]+$/.test(scope)) {
    throw usageFailure(`--scope looks like @acme, not "${scope}"; pass --scope explicitly.`);
  }
  return {
    scope,
    project: project === '' ? 'project' : project,
    app: idOf('--app', flags.app, project),
    module: idOf('--module', flags.module, 'starter'),
  };
}
