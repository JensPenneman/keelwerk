import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { generateManifest } from './generate-manifest.ts';

const core = '@keelwerk/spike-composition-types';
const pad = (i: number): string => String(i).padStart(2, '0');

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function link(from: string, to: string): void {
  mkdirSync(dirname(from), { recursive: true });
  symlinkSync(relative(dirname(from), to), from, 'dir');
}

interface Names {
  readonly n: string;
  readonly prev: string | null;
  readonly prev2: string | null;
}

function names(i: number): Names {
  return { n: pad(i), prev: i > 1 ? pad(i - 1) : null, prev2: i > 2 ? pad(i - 2) : null };
}

/** The part sources of module `i`, by path relative to its src directory; imports are given per file. */
function parts({
  n,
  prev,
  prev2,
}: Names): Readonly<
  Record<string, { readonly imports: readonly string[]; readonly body: string }>
> {
  const files: Record<string, { readonly imports: readonly string[]; readonly body: string }> = {
    'entities/a.ts': {
      imports: [
        `import { defineEntity, field, shape } from '${core}';`,
        ...(prev ? [`import { m${prev} } from '@synthetic/m${prev}';`] : []),
      ],
      body: `export const a = defineEntity({
  prefix: 'a${n}',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    at: field.instant().optional(),
    link: ${prev ? `field.ref(m${prev}, 'a').optional()` : `field.ref.own('b').optional()`},
  },
  events: { renamed: shape({ name: field.string() }) },
  evolve: { renamed: (state, event) => ({ ...state, name: event.name }) },
});`,
    },
    'entities/b.ts': {
      imports: [`import { defineEntity, field } from '${core}';`],
      body: `export const b = defineEntity({
  prefix: 'b${n}',
  fields: { title: field.string(), flag: field.boolean().default(false), kind: field.enum(['x', 'y']), owner: field.ref.own('a') },
});`,
    },
    'entity-actions/a/rename.ts': {
      imports: [
        `import { defineCommand, field, shape } from '${core}';`,
        `import { m${n}Base } from '../../base.ts';`,
        `import { a } from '../../entities/a.ts';`,
      ],
      body: `export const rename = defineCommand(m${n}Base, a, {
  input: shape({ name: field.string() }),
  decide: (input, _current, ctx) => [ctx.events.renamed({ name: input.name })],
});`,
    },
    'entity-actions/a/find.ts': {
      imports: [
        `import { defineQuery, field, pageOf, shape } from '${core}';`,
        `import { m${n}Base } from '../../base.ts';`,
        `import { a } from '../../entities/a.ts';`,
      ],
      body: `export const find = defineQuery(m${n}Base, a, {
  input: shape({ name: field.string() }),
  output: pageOf(a),
  read: (input, ctx) => ctx.target.query({ where: { name: input.name } }),
});`,
    },
    'actions/touch.ts': {
      imports: [
        `import { defineCommand, field, shape } from '${core}';`,
        `import { m${n}Base } from '../base.ts';`,
      ],
      body: `export const touch = defineCommand(m${n}Base, {
  input: shape({ id: field.ref.own('b') }),
  output: shape({ count: field.integer() }),
  *decide(input, ctx) {
    const row = yield* ctx.load.m${n}.b.byId(input.id);
    const count = ${prev ? `yield* ctx.load.m${prev}.a.count({ name: row?.title })` : '0'};
    return { events: row ? [ctx.write.m${n}.b.update(row, { flag: true })] : [], result: { count } };
  },
});`,
    },
  };
  if (prev) {
    files['contributions/to-prev/contribution.ts'] = {
      imports: [
        `import { defineContribution, field } from '${core}';`,
        `import { m${prev} } from '@synthetic/m${prev}';`,
      ],
      body: `export const toPrev = defineContribution(m${prev}, { entities: { a: { fields: { note${n}: field.string().optional() } } } });`,
    };
    files['contributions/to-prev/entity-actions/a/annotate.ts'] = {
      imports: [
        `import { defineCommand, field, shape, within } from '${core}';`,
        `import { m${n}Base } from '../../../../base.ts';`,
        `import { toPrev } from '../../contribution.ts';`,
      ],
      body: `export const annotate = defineCommand(within(m${n}Base, toPrev), 'a', {
  input: shape({ note: field.string() }),
  decide: (input, current, ctx) => [ctx.write.m${prev}.a.update(current, { note${n}: input.note })],
});`,
    };
  }
  if (prev2) {
    files['conditional/when-prev2/condition.ts'] = {
      imports: [
        `import { defineCondition, field } from '${core}';`,
        `import { m${prev2} } from '@synthetic/m${prev2}';`,
      ],
      body: `export const whenPrev2 = defineCondition([m${prev2}], { entities: { b: { fields: { back${n}: field.ref(m${prev2}, 'a').optional() } } } });`,
    };
    files['conditional/when-prev2/actions/sync.ts'] = {
      imports: [
        `import { defineCommand, field, shape, within } from '${core}';`,
        `import { m${n}Base } from '../../../base.ts';`,
        `import { whenPrev2 } from '../condition.ts';`,
      ],
      body: `export const sync = defineCommand(within(m${n}Base, whenPrev2), {
  input: shape({ id: field.ref.own('b') }),
  *decide(input, ctx) {
    const target = yield* ctx.load.m${prev2}.a.one({ where: { name: 'x' } });
    return target ? [ctx.write.m${n}.b.update(input.id, { back${n}: target.id })] : [];
  },
});`,
    };
  }
  return files;
}

function baseSource(
  { n, prev, prev2 }: Names,
  layout: Layout,
): { readonly imports: readonly string[]; readonly body: string } {
  const deps = [prev, prev2].filter((d): d is string => d !== null);
  const local = layout === 'files';
  return {
    imports: [
      `import { defineModuleBase, field, type ModuleBaseType, shape } from '${core}';`,
      ...deps.map((d) => `import { m${d} } from '@synthetic/m${d}';`),
      ...(local && prev2
        ? [`import { whenPrev2 } from './conditional/when-prev2/condition.ts';`]
        : []),
      ...(local && prev
        ? [`import { toPrev } from './contributions/to-prev/contribution.ts';`]
        : []),
      ...(local
        ? [`import { a } from './entities/a.ts';`, `import { b } from './entities/b.ts';`]
        : []),
    ],
    body: `const m${n}BaseDef = defineModuleBase({
  id: 'm${n}',
  version: '0.1.0',
  requires: [${deps.map((d) => `m${d}`).join(', ')}],
  config: shape({ limit: field.integer().default(10) }),
  entities: { a, b },${prev ? '\n  contributions: { toPrev },' : ''}${prev2 ? '\n  conditions: { whenPrev2 },' : ''}
});

export interface M${n}Base extends ModuleBaseType<typeof m${n}BaseDef> {}
export const m${n}Base: M${n}Base = m${n}BaseDef;`,
  };
}

function singleFile(names: Names): string {
  const all = parts(names);
  const order = [
    'entities/a.ts',
    'entities/b.ts',
    'contributions/to-prev/contribution.ts',
    'conditional/when-prev2/condition.ts',
  ];
  const imports = new Set<string>();
  const coreNames = new Set<string>([
    'defineModule',
    'type ModuleType',
    'defineModuleBase',
    'field',
    'type ModuleBaseType',
    'shape',
  ]);
  const base = baseSource(names, 'single');
  for (const line of [...base.imports, ...Object.values(all).flatMap((p) => p.imports)]) {
    const fromCore = line.match(/^import \{ (.+) \} from '@keelwerk\/spike-composition-types';$/);
    if (fromCore?.[1]) for (const name of fromCore[1].split(', ')) coreNames.add(name);
    else if (line.includes('@synthetic/')) imports.add(line);
  }
  const strip = (body: string): string => body.replaceAll(/^export const /gm, 'const ');
  const declarations = order
    .filter((path) => all[path])
    .map((path) => strip(all[path]?.body ?? ''));
  const rest = Object.keys(all)
    .filter((path) => !order.includes(path))
    .map((path) => strip(all[path]?.body ?? ''));
  const baseBody = base.body
    .replace(`export interface M${names.n}Base`, `interface M${names.n}Base`)
    .replace(`export const m${names.n}Base`, `const m${names.n}Base`);
  const literal = [
    '  actions: { touch },',
    '  entityActions: { a: { rename, find } },',
    ...(names.prev ? ['  contributes: { toPrev: { entityActions: { a: { annotate } } } },'] : []),
    ...(names.prev2 ? ['  conditional: { whenPrev2: { actions: { sync } } },'] : []),
  ].join('\n');
  return [
    `import { ${[...coreNames].sort((x, y) => x.replace('type ', '').localeCompare(y.replace('type ', ''))).join(', ')} } from '${core}';`,
    ...[...imports].sort(),
    '',
    ...declarations,
    baseBody,
    ...rest,
    `const moduleDef = defineModule(m${names.n}Base, {\n${literal}\n});`,
    '',
    `/** The m${names.n} module. */`,
    `export interface M${names.n} extends ModuleType<typeof moduleDef> {}`,
    `export const m${names.n}: M${names.n} = moduleDef;`,
    '',
  ].join('\n');
}

/** How a synthetic module is written: parts in files with a generated manifest, or everything in one file. */
export type Layout = 'files' | 'single';

/**
 * Writes a synthetic workspace in the pnpm layout: one package per module, each with a node_modules
 * holding symlinks to its declared workspace dependencies only, project references between them,
 * and an app package composing all of them. Every module has two entities of four fields, two entity
 * actions, a module action, a contribution and a conditional part, and requires its two predecessors.
 */
export function writeSyntheticWorkspace(
  root: string,
  count: number,
  layout: Layout,
  spikeDir: string,
  typeRoots: string,
): void {
  rmSync(root, { recursive: true, force: true });
  const base = JSON.parse(
    readFileSync(join(spikeDir, '..', '..', 'tsconfig.base.json'), 'utf8'),
  ) as { compilerOptions: object };
  write(
    join(root, 'tsconfig.base.json'),
    JSON.stringify(
      { compilerOptions: { ...base.compilerOptions, typeRoots: [typeRoots] } },
      null,
      2,
    ),
  );
  const entry = layout === 'files' ? 'module.generated' : 'module';
  const ids = Array.from({ length: count }, (_, i) => pad(i + 1));
  for (let i = 1; i <= count; i++) {
    const names_ = names(i);
    const dir = join(root, 'packages', `m${names_.n}`);
    const deps = [names_.prev, names_.prev2].filter((d): d is string => d !== null);
    write(
      join(dir, 'package.json'),
      JSON.stringify(
        {
          name: `@synthetic/m${names_.n}`,
          private: true,
          type: 'module',
          exports: {
            '.': {
              '@keelwerk/source': `./src/${entry}.ts`,
              types: `./dist/${entry}.d.ts`,
              default: `./dist/${entry}.js`,
            },
          },
          dependencies: Object.fromEntries([
            [core, 'workspace:*'],
            ...deps.map((d) => [`@synthetic/m${d}`, 'workspace:*']),
          ]),
        },
        null,
        2,
      ),
    );
    write(
      join(dir, 'tsconfig.json'),
      JSON.stringify(
        {
          extends: '../../tsconfig.base.json',
          compilerOptions: { rootDir: 'src', outDir: 'dist' },
          include: ['src'],
          references: [
            { path: join(spikeDir, 'tsconfig.json') },
            ...deps.map((d) => ({ path: `../m${d}` })),
          ],
        },
        null,
        2,
      ),
    );
    link(join(dir, 'node_modules', '@keelwerk', 'spike-composition-types'), spikeDir);
    for (const d of deps)
      link(join(dir, 'node_modules', '@synthetic', `m${d}`), join(root, 'packages', `m${d}`));
    if (layout === 'files') {
      for (const [path, part] of Object.entries(parts(names_)))
        write(join(dir, 'src', path), `${part.imports.join('\n')}\n\n${part.body}\n`);
      const b = baseSource(names_, 'files');
      write(join(dir, 'src', 'base.ts'), `${b.imports.join('\n')}\n\n${b.body}\n`);
      write(
        join(dir, 'src', 'module.generated.ts'),
        generateManifest(join(dir, 'src'), `m${names_.n}`, core),
      );
    } else {
      write(join(dir, 'src', 'module.ts'), singleFile(names_));
    }
  }
  const app = join(root, 'app');
  write(
    join(app, 'package.json'),
    JSON.stringify({ name: '@synthetic/app', private: true, type: 'module' }, null, 2),
  );
  write(
    join(app, 'tsconfig.json'),
    JSON.stringify(
      {
        extends: '../tsconfig.base.json',
        compilerOptions: { rootDir: 'src', outDir: 'dist' },
        include: ['src'],
        references: [
          { path: join(spikeDir, 'tsconfig.json') },
          ...ids.map((d) => ({ path: `../packages/m${d}` })),
        ],
      },
      null,
      2,
    ),
  );
  link(join(app, 'node_modules', '@keelwerk', 'spike-composition-types'), spikeDir);
  for (const d of ids)
    link(join(app, 'node_modules', '@synthetic', `m${d}`), join(root, 'packages', `m${d}`));
  write(
    join(app, 'src', 'modules.ts'),
    `${ids.map((d) => `import { m${d} } from '@synthetic/m${d}';`).join('\n')}\n\nexport const modules = [${ids.map((d) => `m${d}`).join(', ')}] as const;\n`,
  );
  write(
    join(app, 'src', 'app.ts'),
    `import { type AppType, defineApp } from '${core}';
import { modules } from './modules.ts';

const appDef = defineApp({ id: 'synthetic', modules });

export interface SyntheticApp extends AppType<typeof appDef> {}
export const app: SyntheticApp = appDef;
`,
  );
  const last = ids.at(-1);
  write(
    join(app, 'src', 'consume.ts'),
    `import type { ActionRef, AppActionTree, Row } from '${core}';
import type { SyntheticApp } from './app.ts';

export const firstRef: ActionRef<SyntheticApp> = '${ids[0] ? `m${ids[0]}.a.get` : 'core.tenant.get'}';
export type LastRow = Row<SyntheticApp, '${last ? `m${last}.a` : 'core.tenant'}'>;
export const lastField: keyof LastRow = 'id';
export const lastKind: AppActionTree<SyntheticApp>['${last ? `m${last}` : 'core'}']['entities']['${last ? 'a' : 'tenant'}']['get']['kind'] = 'query';
`,
  );
  write(
    join(root, 'tsconfig.json'),
    JSON.stringify(
      {
        files: [],
        references: [...ids.map((d) => ({ path: `packages/m${d}` })), { path: 'app' }],
      },
      null,
      2,
    ),
  );
  write(
    join(root, 'tsconfig.mono.json'),
    JSON.stringify(
      {
        extends: './tsconfig.base.json',
        compilerOptions: {
          composite: false,
          declaration: false,
          declarationMap: false,
          sourceMap: false,
          noEmit: true,
        },
        include: ['packages/*/src', 'app/src'],
      },
      null,
      2,
    ),
  );
}
