import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type AnyModule, defineApp, version } from '@keelwerk/core';
import { renderModuleManifest, scanModuleDirectory } from '@keelwerk/core/manifest';
import { expect, test } from 'vitest';
import { useNewWorkspace } from './support/new-workspace.ts';

// A git-ignored directory of this package, so that `@keelwerk/core` resolves from the copies.
const scratch = fileURLToPath(new URL('../.keelwerk/new-composes', import.meta.url));
const workspace = useNewWorkspace(scratch);
const { runNew, listing } = workspace;

function printedEdits(stdout: string): { imports: string[]; members: Map<string, string> } {
  const imports: string[] = [];
  const members = new Map<string, string>();
  for (const line of stdout.split('\n').map((text) => text.trim())) {
    const member = /^(\w+): (.*),$/.exec(line);
    if (line.startsWith('import ')) {
      imports.push(line);
    } else if (member?.[1] !== undefined && member[2] !== undefined) {
      members.set(member[1], member[2]);
    }
  }
  return { imports, members };
}

async function regenerate(root: string, id: string): Promise<void> {
  const source = join(root, 'src');
  const files = (await listing(source)).filter((path) => path !== 'module.generated.ts');
  const scanned = scanModuleDirectory(files);
  expect(scanned.unplaced).toEqual([]);
  await writeFile(
    join(source, 'module.generated.ts'),
    renderModuleManifest({ id, generatorVersion: version, scanned, migrations: false }),
  );
}

type Loaded<Id extends string> = AnyModule & { readonly id: Id };

function hasId<Id extends string>(found: AnyModule, id: Id): found is Loaded<Id> {
  return found.id === id;
}

async function load<Id extends string>(root: string, id: Id): Promise<Loaded<Id>> {
  const loaded: Record<string, AnyModule> = await import(
    pathToFileURL(join(root, 'src', 'module.generated.ts')).href
  );
  const found = loaded[id];
  if (found === undefined || !hasId(found, id)) {
    throw new Error(`${root} exports no module ${id}`);
  }
  return found;
}

test('every M1 kind scaffolded into a copy of the library composes, alone and with an optional module', async () => {
  const library = await workspace.libraryCopy();
  const extras = join(workspace.root(), 'modules', 'extras');
  await mkdir(join(extras, 'src'), { recursive: true });
  await writeFile(
    join(extras, 'src', 'base.ts'),
    `import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';

const extrasBaseDef = defineModuleBase({ id: 'extras', version: '0.1.0' });

export interface ExtrasBase extends ModuleBaseType<typeof extrasBaseDef> {}
export const extrasBase: ExtrasBase = extrasBaseDef;
`,
  );
  await regenerate(extras, 'extras');
  const imports: string[] = [];
  const members = new Map<string, string[]>();
  const runs: string[][] = [
    ['entity', 'library.reader'],
    ['action', 'library.borrow'],
    ['action', 'library.list-books', '--kind', 'query'],
    ['action', 'library.reader.register'],
    ['rule', 'library.borrow.signed-in'],
    ['rule', 'library.book.no-reading', '--effect', 'deny'],
    ['flag', 'library.newFlow', '--expires', '2027-01-31'],
    ['service', 'library.find-title'],
    ['reaction', 'library.on-book', '--on', 'library.book.created'],
    ['lib', 'library.add-days'],
    ['shape', 'library.loan-window'],
    ['effect', 'library.send-notice'],
    ['executor', 'library.send-notice'],
    ['schedule', 'library.borrow', '--every', '5m'],
    ['condition', 'library.when-extras'],
    ['action', 'library.sync', '--when', 'extras'],
    ['rule', 'library.sync.open', '--when', 'extras'],
  ];
  for (const argv of runs) {
    const run = await runNew(...argv, '--dir', 'modules/library');
    expect(run.stderr, argv.join(' ')).toBe('');
    const edits = printedEdits(run.stdout);
    imports.push(...edits.imports);
    for (const [key, value] of edits.members) {
      members.set(key, [...(members.get(key) ?? []), value]);
    }
  }
  const baseFile = join(library, 'src', 'base.ts');
  const extrasFrom = relative(join(library, 'src'), join(extras, 'src', 'module.generated.ts'));
  const merged = [...members].map(([key, values]) => {
    const names = values.flatMap((value) => value.replace(/^[[{]\s*|\s*[\]}]$/g, '').split(', '));
    const inner = [...new Set(names)].join(', ');
    return key === 'entities'
      ? `  entities: { book, ${inner.replace(/^book, /, '')} },`
      : `  ${key}: ${values[0]?.startsWith('[') ? `[${inner}]` : `{ ${inner} }`},`;
  });
  const base = (await readFile(baseFile, 'utf8'))
    .replace('  entities: { book },\n', '')
    .replace("version: '0.1.0',\n", `version: '0.1.0',\n${merged.join('\n')}\n`);
  const importLines = [...new Set(imports)]
    .filter((line) => !line.includes("from './entities/book.ts'"))
    .map((line) => line.replace("'@acme/module-extras'", `'${extrasFrom}'`));
  await writeFile(
    baseFile,
    `${importLines.join('\n')}\nimport { book } from './entities/book.ts';\n${base.replace(/^import \{ book \}.*\n/m, '')}`,
  );
  const condition = join(library, 'src/conditional/when-extras/condition.ts');
  await writeFile(
    condition,
    (await readFile(condition, 'utf8')).replace(
      "'@acme/module-extras'",
      `'${relative(dirname(condition), join(extras, 'src', 'module.generated.ts'))}'`,
    ),
  );
  await regenerate(library, 'library');
  const libraryModule = await load(library, 'library');
  const extrasModule = await load(extras, 'extras');
  expect(defineApp({ id: 'alone', modules: [libraryModule] }).registry.problems).toEqual([]);
  expect(
    defineApp({ id: 'with-extras', modules: [libraryModule, extrasModule] }).registry.problems,
  ).toEqual([]);
});
