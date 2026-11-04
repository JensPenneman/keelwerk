import { camelFromKebab } from '../naming/camel-from-kebab.ts';
import { mountKey } from './mount-key.ts';
import { type PartConvention, type PartKind, partConventions } from './part-conventions.ts';

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ROOT_FILES: ReadonlySet<string> = new Set(['base.ts', 'config.ts', 'module.generated.ts']);
const DECLARATION_DIRECTORIES: ReadonlySet<string> = new Set([
  'entities',
  'errors',
  'extension-points',
  'flags',
  'lib',
  'shapes',
  'streams',
]);
const SCOPE_DIRECTORIES: ReadonlyMap<string, { section: PartScope['section']; file: string }> =
  new Map([
    ['conditional', { section: 'conditional', file: 'condition.ts' }],
    ['contributions', { section: 'contributes', file: 'contribution.ts' }],
  ]);

function isSource(path: string): boolean {
  return path.endsWith('.ts') && !/\.(test|test-d|d)\.ts$/.test(path);
}

function stripWord(directory: string): string {
  return camelFromKebab(directory.replace(/^(to|when)-/, ''));
}

function place(
  path: string,
  segments: readonly string[],
  scope: PartScope | undefined,
): ScannedPart | string {
  const [directory, ...rest] = segments;
  const convention: PartConvention | undefined = partConventions.find(
    (candidate) =>
      candidate.directory === directory && (scope ? candidate.scoped : candidate.module),
  );
  if (convention === undefined) return 'no convention places a file in this directory';
  if (convention.directory === 'executors' && rest[0] === 'lib' && rest.length > 1) return '';
  const file = rest.at(-1)?.slice(0, -'.ts'.length) ?? '';
  const owner = rest.length === 2 ? rest[0] : undefined;
  if (rest.length > 2 || (rest.length === 2 && convention.ownedSection === undefined)) {
    return 'this directory is nested deeper than the conventions read';
  }
  if (!KEBAB.test(file) || (owner !== undefined && !KEBAB.test(owner))) {
    return 'a file and a directory name are kebab-case (section 23.4)';
  }
  const { key, exportName } = mountKey(file, convention.suffix);
  return {
    path: `./${path}`,
    kind: convention.kind,
    scope,
    section: owner === undefined ? convention.section : (convention.ownedSection ?? ''),
    owner: owner === undefined ? undefined : camelFromKebab(owner),
    key,
    exportName,
  };
}

function classify(path: string): ScannedPart | UnplacedFile | undefined {
  const segments = path.split('/');
  const [first, second, ...rest] = segments;
  if (first === undefined) return undefined;
  if (segments.length === 1) {
    return ROOT_FILES.has(first) ? undefined : { path, reason: 'no convention places a file here' };
  }
  if (DECLARATION_DIRECTORIES.has(first)) return undefined;
  const scopeDirectory = SCOPE_DIRECTORIES.get(first);
  let placed: ScannedPart | string;
  if (scopeDirectory !== undefined) {
    if (second === undefined || !KEBAB.test(second)) {
      return { path, reason: 'a declaration directory is kebab-case (section 23.4)' };
    }
    if (rest.length === 1 && rest[0] === scopeDirectory.file) return undefined;
    placed = place(path, rest, {
      section: scopeDirectory.section,
      key: camelFromKebab(second),
      name: stripWord(second),
    });
  } else {
    placed = place(path, segments, undefined);
  }
  if (placed === '') return undefined;
  return typeof placed === 'string' ? { path, reason: placed } : placed;
}

function slot(part: ScannedPart): string {
  const scope = part.scope ? `${part.scope.section}.${part.scope.key}` : '';
  return [scope, part.section, part.owner ?? '', part.key].join('/');
}

function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The contribution or conditional part a scanned part belongs to. */
export interface PartScope {
  readonly section: 'conditional' | 'contributes';
  /** The declaration's export, the camel case of its directory (`toAccounts`). */
  readonly key: string;
  /** The words after `to-` or `when-`, in camel case (`accounts`), for import aliases. */
  readonly name: string;
}

/** A part file the conventions place, with the mount and the export name they imply. */
export interface ScannedPart {
  /** The import specifier from `src/module.generated.ts` (`./actions/login.ts`). */
  readonly path: string;
  readonly kind: PartKind;
  readonly scope: PartScope | undefined;
  /** The literal section: `actions`, `entityActions`, `policies`, `extensionPoints` and so on. */
  readonly section: string;
  /** The entity or policy target named by the subdirectory, when the file sits in one. */
  readonly owner: string | undefined;
  readonly key: string;
  readonly exportName: string;
}

/** A file the conventions cannot place, with the reason; such a file stays unmounted. */
export interface UnplacedFile {
  readonly path: string;
  readonly reason: string;
}

/** What a scan of a module's `src/` finds. */
export interface ScannedModule {
  readonly parts: readonly ScannedPart[];
  readonly unplaced: readonly UnplacedFile[];
}

/**
 * Reads a module's file listing (paths relative to `src/`, with `/` separators) and says what the
 * conventions of section 23.5 mount where. It reads names and paths only and imports nothing from
 * the module, so it runs in milliseconds before any type check. A file in the wrong place is
 * returned as unplaced, never guessed at.
 */
export function scanModuleDirectory(files: readonly string[]): ScannedModule {
  const parts: ScannedPart[] = [];
  const unplaced: UnplacedFile[] = [];
  const taken = new Map<string, string>();
  const targets = new Set<string>();
  for (const path of files.filter(isSource).toSorted(compareCodeUnits)) {
    const found = classify(path);
    if (found === undefined) continue;
    if ('reason' in found) {
      unplaced.push(found);
      continue;
    }
    const where = slot(found);
    const flatPolicy = found.section === 'policies' && found.owner === undefined;
    const target = flatPolicy ? found.key : found.owner;
    const targetSlot = `${found.scope?.key ?? ''}/${target ?? ''}`;
    const clash = taken.get(where);
    if (clash !== undefined) {
      unplaced.push({ path, reason: `it would be mounted where ${clash} already is` });
      continue;
    }
    if (found.section === 'policies') {
      const other = targets.has(`${flatPolicy ? 'dir' : 'flat'}:${targetSlot}`);
      if (other) {
        unplaced.push({ path, reason: `a policy target and a rule share the name ${target}` });
        continue;
      }
      targets.add(`${flatPolicy ? 'flat' : 'dir'}:${targetSlot}`);
    }
    taken.set(where, path);
    parts.push(found);
  }
  return { parts, unplaced };
}
