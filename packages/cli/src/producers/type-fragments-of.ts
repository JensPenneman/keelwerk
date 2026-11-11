import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { TypeFragment } from '@keelwerk/core';
import type { AppDerivation } from './app-derivation.ts';
import { projectSurface } from './project-surface.ts';
import { readIfPresent } from './read-if-present.ts';
import { shownPath } from './shown-path.ts';
import { transportsOf } from './transports-of.ts';

const DECLARATION = /^export type ([A-Za-z_$][\w$]*)[<\s=]/;
const IMPORT_NAME = /^[A-Za-z_$][\w$]*( as [A-Za-z_$][\w$]*)?$/;
const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const MAX_DECLARATION = 99;

interface Accepted {
  readonly transport: string;
  readonly fragment: TypeFragment;
  readonly declared: string;
  /** The imported names by local name. */
  readonly locals: readonly string[];
}

/** Whether the text is one line `export type <Name> ...` that the generated file can hold as is. */
function declarationName(content: string): string | undefined {
  if (/[\r\n]/.test(content) || content !== content.trim() || content.endsWith(';')) return;
  if (content.length > MAX_DECLARATION) return;
  let depth = 0;
  for (const character of content) {
    if (character === '{') depth += 1;
    else if (character === '}') depth -= 1;
    else if (character === ';' && depth === 0) return;
  }
  return DECLARATION.exec(content)?.[1];
}

function localName(name: string): string {
  return name.split(' as ')[1] ?? name;
}

function importedName(name: string): string {
  return name.split(' as ')[0] ?? name;
}

/** The declared names and the imports (local name to module) of the fragment-free file. */
function takenIn(plain: string): {
  declared: Set<string>;
  imported: Map<string, { module: string; name: string }>;
} {
  const declared = new Set<string>();
  for (const match of plain.matchAll(/^export (?:type|const) ([A-Za-z_$][\w$]*)/gm)) {
    if (match[1] !== undefined) declared.add(match[1]);
  }
  const imported = new Map<string, { module: string; name: string }>();
  for (const match of plain.matchAll(/import type \{([^}]*)\} from '([^']+)';/g)) {
    for (const name of (match[1] ?? '').split(',')) {
      const trimmed = name.trim();
      if (trimmed !== '' && match[2] !== undefined) {
        imported.set(localName(trimmed), { module: match[2], name: importedName(trimmed) });
      }
    }
  }
  return { declared, imported };
}

type Manifest =
  | { readonly kind: 'found'; readonly path: string; readonly listed: ReadonlySet<string> }
  | {
      readonly kind: 'invalid';
      readonly path: string;
      readonly reason: 'not JSON' | 'not an object';
    };

function inside(root: string, path: string): boolean {
  const way = relative(root, path);
  return way !== '..' && !way.startsWith(`..${sep}`) && !isAbsolute(way);
}

/**
 * The nearest `package.json` from `directory` upward, stopping at the workspace root inclusive; an
 * app outside the workspace has none. Both paths are resolved first, so a relative root or one with
 * a trailing separator walks the same way.
 */
async function owningManifest(root: string, directory: string): Promise<Manifest | undefined> {
  const top = resolve(root);
  if (!inside(top, resolve(directory))) return undefined;
  for (let current = resolve(directory); ; current = dirname(current)) {
    const path = join(current, 'package.json');
    const text = await readIfPresent(path);
    if (text !== undefined) {
      let manifest: unknown;
      try {
        manifest = JSON.parse(text);
      } catch {
        return { kind: 'invalid', path, reason: 'not JSON' };
      }
      if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
        return { kind: 'invalid', path, reason: 'not an object' };
      }
      const listed = new Set<string>();
      for (const key of ['dependencies', 'peerDependencies']) {
        const table = (manifest as Record<string, unknown>)[key];
        if (typeof table === 'object' && table !== null) {
          for (const name of Object.keys(table)) listed.add(name);
        }
      }
      return { kind: 'found', path, listed };
    }
    if (current === top || dirname(current) === current) return undefined;
  }
}

/**
 * The type fragments the app's transports hand to `keelwerk.generated.ts` (section 13.7, S-128):
 * the `type-fragment` artefacts of the head surface only, read as data and checked against the
 * fragment-free file `plain`. Failures name the app; with any failure `fragments` is empty.
 */
export async function typeFragmentsOf(
  root: string,
  app: AppDerivation,
  plain: string,
): Promise<{ readonly fragments: readonly TypeFragment[]; readonly failures: readonly string[] }> {
  const head = app.surfaces.at(-1);
  if (head === undefined) return { fragments: [], failures: [] };
  const s = app.shown;
  const failures: string[] = [];
  const accepted: Accepted[] = [];
  let manifest: Manifest | undefined;
  let manifestRead = false;
  let invalidReported = false;
  for (const transport of transportsOf(app.app)) {
    const t = transport.name;
    const projection = projectSurface(transport, head);
    if (projection.problems.length > 0) {
      failures.push(
        `${s}: ${t} ${head.apiVersion}: the transport cannot project the head surface, so src/keelwerk.generated.ts is not written`,
      );
      continue;
    }
    for (const artifact of projection.artifacts) {
      if (artifact.kind !== 'type-fragment') continue;
      const { content, module, names } = artifact;
      const declared = declarationName(content);
      if (declared === undefined) {
        failures.push(
          `${s}: ${t}: a type fragment is one line 'export type <Name> = ...' of at most 99 characters without a closing semicolon: ${JSON.stringify(content)}`,
        );
        continue;
      }
      if (module === undefined && names !== undefined) {
        failures.push(`${s}: ${t}: a type fragment names ${names.join(', ')} without a module`);
        continue;
      }
      if (module === undefined) {
        accepted.push({
          transport: t,
          fragment: { module: '@keelwerk/core', names: [], declaration: content },
          declared,
          locals: [],
        });
        continue;
      }
      if (names === undefined || names.length === 0) {
        failures.push(`${s}: ${t}: a type fragment imports nothing from ${module}`);
        continue;
      }
      const badName = names.find((name) => !IMPORT_NAME.test(name));
      if (badName !== undefined) {
        failures.push(
          `${s}: ${t}: a type fragment imports ${JSON.stringify(badName)}, which is no name or 'name as alias'`,
        );
        continue;
      }
      if (!PACKAGE_NAME.test(module)) {
        failures.push(
          `${s}: ${t}: a type fragment imports ${module}, which is no package name (relative, absolute, built-in and subpath imports are refused)`,
        );
        continue;
      }
      if (!manifestRead) {
        manifest = await owningManifest(root, app.directory);
        manifestRead = true;
      }
      if (manifest?.kind === 'invalid') {
        if (!invalidReported) {
          const wording =
            manifest.reason === 'not JSON' ? 'is not valid JSON' : 'is not a JSON object';
          failures.push(`${s}: ${shownPath(root, manifest.path)} ${wording}`);
          invalidReported = true;
        }
        continue;
      }
      if (manifest === undefined) {
        failures.push(
          `${s}: ${t}: a type fragment imports ${module}, but no package.json owns the app`,
        );
        continue;
      }
      if (!manifest.listed.has(module)) {
        failures.push(
          `${s}: ${t}: a type fragment imports ${module}, which ${shownPath(root, manifest.path)} does not list in dependencies or peerDependencies`,
        );
        continue;
      }
      const locals = names.map(localName);
      const unused = locals.find(
        (local) =>
          !new RegExp(`(?<![\\w$])${local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`).test(
            content,
          ),
      );
      if (unused !== undefined) {
        failures.push(
          `${s}: ${t}: a type fragment imports ${unused} from ${module} without using it`,
        );
        continue;
      }
      accepted.push({
        transport: t,
        fragment: { module, names: [...names], declaration: content },
        declared,
        locals,
      });
    }
  }
  const taken = takenIn(plain);
  const bound = new Map(taken.imported);
  const declaredBy = new Set<string>();
  const allDeclared = new Set(accepted.map((entry) => entry.declared));
  const reported = new Set<string>();
  for (const entry of accepted) {
    const { declared } = entry;
    const names = entry.fragment.names ?? [];
    if (taken.declared.has(declared) || taken.imported.has(declared)) {
      failures.push(
        `${s}: ${entry.transport}: a type fragment declares ${declared}, which the generated file already declares or imports`,
      );
    } else if (declaredBy.has(declared)) {
      if (!reported.has(declared)) failures.push(`${s}: two type fragments declare ${declared}`);
      reported.add(declared);
    }
    declaredBy.add(declared);
    names.forEach((specifier, index) => {
      const local = entry.locals[index] ?? specifier;
      const mine = { module: entry.fragment.module, name: importedName(specifier) };
      if (taken.declared.has(local) || allDeclared.has(local)) {
        failures.push(
          `${s}: ${entry.transport}: a type fragment imports ${local}, which the generated file or a type fragment declares`,
        );
        return;
      }
      const first = bound.get(local);
      if (first !== undefined && (first.module !== mine.module || first.name !== mine.name)) {
        failures.push(
          `${s}: two type fragments import ${local} from ${first.module} and ${mine.module}`,
        );
      } else {
        bound.set(local, mine);
      }
    });
  }
  if (failures.length > 0) return { fragments: [], failures };
  return { fragments: accepted.map((entry) => entry.fragment), failures: [] };
}
