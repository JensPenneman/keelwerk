import { kebab } from '@keelwerk/core';
import { usageFailure } from '../../context/usage-failure.ts';
import { isModuleId } from '../../scaffold/is-module-id.ts';
import { laterKinds } from '../../scaffold/later-kinds.ts';
import { locateReference } from '../../scaffold/locate-reference.ts';
import type { NewKind } from '../../scaffold/new-kind.ts';
import { newKinds } from '../../scaffold/new-kinds.ts';
import { packageDirectory } from '../../scaffold/package-directory.ts';
import { parseReference } from '../../scaffold/parse-reference.ts';
import type { ScaffoldRequest } from '../../scaffold/scaffold-request.ts';
import { workspaceFacts } from '../../scaffold/workspace-facts.ts';
import type { NewFlags } from './new-flags.ts';
import { splitList } from './split-list.ts';

const PLACED_KINDS: readonly NewKind[] = ['action', 'rule', 'reaction'];

function isNewKind(kind: string): kind is NewKind {
  return (newKinds as readonly string[]).includes(kind);
}

function checkOptions(options: {
  readonly requires: readonly string[];
  readonly optional: readonly string[];
  readonly when: readonly string[];
  readonly modules: readonly string[];
  readonly from: string | undefined;
  readonly app: string | undefined;
  readonly scope: string | undefined;
}): void {
  const lists: [string, readonly string[]][] = [
    ['--requires', options.requires],
    ['--optional', options.optional],
    ['--when', options.when],
    ['--modules', options.modules],
    ['--from', options.from === undefined ? [] : [options.from]],
    ['--app', options.app === undefined ? [] : [options.app]],
  ];
  for (const [flag, ids] of lists) {
    for (const id of ids) {
      if (!isModuleId(id)) {
        throw usageFailure(`${flag} takes kebab-case ids, not "${id}".`);
      }
    }
  }
  if (options.scope !== undefined && !/^@[a-z0-9-]+$/.test(options.scope)) {
    throw usageFailure(`--scope looks like @acme, not "${options.scope}".`);
  }
}

/**
 * Turns `new <kind> <reference>` and its flags into the request the templates read: refuses
 * kinds of later milestones, finds the module package, and reads the workspace around it.
 */
export async function prepareRequest(
  cwd: string,
  kind: string,
  reference: string,
  flags: NewFlags,
): Promise<ScaffoldRequest> {
  const milestone = laterKinds[kind];
  if (milestone !== undefined) {
    throw usageFailure(
      `keelwerk new ${kind} is not available yet: ${kind} parts belong to milestone ${milestone}. M1 scaffolds ${newKinds.join(', ')}.`,
    );
  }
  if (!isNewKind(kind)) {
    throw usageFailure(`Unknown kind "${kind}". M1 scaffolds ${newKinds.join(', ')}.`);
  }
  const options = {
    kind: flags.kind,
    requires: splitList(flags.requires),
    optional: splitList(flags.optional),
    app: flags.app,
    from: flags.from,
    when: splitList(flags.when),
    level: flags.level,
    purpose: flags.purpose,
    expires: flags.expires,
    effect: flags.effect,
    on: flags.on,
    every: flags.every,
    modules: splitList(flags.modules),
    scope: flags.scope,
    dir: flags.dir,
  };
  checkOptions(options);
  if ((options.from !== undefined || options.when.length > 0) && !PLACED_KINDS.includes(kind)) {
    throw usageFailure(`--from and --when place an action, a rule or a reaction, not a ${kind}.`);
  }
  const parsed = parseReference(kind === 'script' ? kebab(reference) : reference);
  if (kind === 'module' || kind === 'app' || kind === 'script') {
    const facts = workspaceFacts(cwd, options.scope, undefined);
    let root = '.';
    if (kind === 'module') {
      root = `${facts.packagesLayout ? 'packages' : 'modules'}/${packageDirectory(parsed.target, facts.packagesLayout)}`;
    } else if (kind === 'app') {
      root = `apps/${parsed.target}`;
    }
    return {
      kind,
      target: parsed.target,
      host: parsed.target,
      names: parsed.names,
      root,
      files: new Set(),
      options,
      ...facts,
    };
  }
  const host = options.from ?? parsed.target;
  const located = await locateReference(cwd, host, options.dir);
  const facts = workspaceFacts(cwd, options.scope, located.root);
  return {
    kind,
    target: parsed.target,
    host,
    names: parsed.names,
    root: located.root,
    files: located.files,
    options,
    ...facts,
  };
}
