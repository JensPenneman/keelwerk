// Writes the synthetic workspaces the type budgets are measured on (architecture 13.11): one package
// per module in the pnpm layout, each module the spike's synthetic module with its manifest produced
// by the generator, and an app package composing all of them. Nothing here is committed output.
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderModuleManifest } from '../../packages/core/src/manifest/render-module-manifest.ts';
import { scanModuleDirectory } from '../../packages/core/src/manifest/scan-module-directory.ts';
import { version } from '../../packages/core/src/version.ts';

const core = '@keelwerk/core';
const pad = (index: number): string => String(index).padStart(2, '0');

interface Names {
  readonly n: string;
  /** The module number as lower-case letters, which is all a TypeID prefix may hold. */
  readonly letters: string;
  readonly prev: string | null;
  readonly prev2: string | null;
}

interface Source {
  readonly imports: readonly string[];
  readonly body: string;
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function link(from: string, to: string): void {
  mkdirSync(dirname(from), { recursive: true });
  symlinkSync(to, from, 'dir');
}

function names(index: number): Names {
  return {
    n: pad(index),
    letters: String.fromCharCode(97 + Math.floor((index - 1) / 26), 97 + ((index - 1) % 26)),
    prev: index > 1 ? pad(index - 1) : null,
    prev2: index > 2 ? pad(index - 2) : null,
  };
}

/** The part sources of one module, by path relative to its `src` directory. */
function parts({ n, letters, prev, prev2 }: Names): Readonly<Record<string, Source>> {
  const files: Record<string, Source> = {
    'entities/a.ts': {
      imports: [
        `import { defineEntity, type EntityType, field, shape } from '${core}';`,
        ...(prev ? [`import { m${prev} } from '@synthetic/m${prev}';`] : []),
      ],
      body: `const aDef = defineEntity({
  prefix: 'a${letters}',
  fields: {
    name: field.string(),
    count: field.integer().default(0),
    at: field.instant().optional(),
    link: ${prev ? `field.ref(m${prev}, 'a').optional()` : `field.ref.own('b').optional()`},
  },
  events: { renamed: shape({ name: field.string() }) },
  evolve: { renamed: (state, event) => ({ ...state, name: event.name }) },
});

export interface A extends EntityType<typeof aDef> {}
export const a: A = aDef;`,
    },
    'entities/b.ts': {
      imports: [`import { defineEntity, type EntityType, field } from '${core}';`],
      body: `const bDef = defineEntity({
  prefix: 'b${letters}',
  fields: {
    title: field.string(),
    flag: field.boolean().default(false),
    kind: field.enum(['x', 'y']),
    owner: field.ref.own('a'),
  },
});

export interface B extends EntityType<typeof bDef> {}
export const b: B = bDef;`,
    },
    'actions/a/rename.ts': {
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
    'actions/a/find.ts': {
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
      body: `export const toPrev = defineContribution(m${prev}, {
  entities: { a: { fields: { note${n}: field.string().optional() } } },
});`,
    };
    files['contributions/to-prev/actions/a/annotate.ts'] = {
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
      body: `export const whenPrev2 = defineCondition([m${prev2}], {
  entities: { b: { fields: { back${n}: field.ref(m${prev2}, 'a').optional() } } },
});`,
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

function baseSource({ n, prev, prev2 }: Names): Source {
  const deps = [prev, prev2].filter((d): d is string => d !== null);
  return {
    imports: [
      `import { defineModuleBase, field, type ModuleBaseType, shape } from '${core}';`,
      ...deps.map((d) => `import { m${d} } from '@synthetic/m${d}';`),
      ...(prev2 ? [`import { whenPrev2 } from './conditional/when-prev2/condition.ts';`] : []),
      ...(prev ? [`import { toPrev } from './contributions/to-prev/contribution.ts';`] : []),
      `import { a } from './entities/a.ts';`,
      `import { b } from './entities/b.ts';`,
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

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Writes a synthetic workspace under `root` in the pnpm layout: one package per module with a
 * node_modules holding symlinks to its declared dependencies only, project references between
 * them, and an app package composing all of them. Every module has two entities of four fields, two
 * entity actions, a module action, a contribution and a conditional part, and requires its two
 * predecessors. `repo` is the keelwerk checkout whose core the modules build against.
 */
export function generateSyntheticApps(root: string, count: number, repo: string): void {
  rmSync(root, { recursive: true, force: true });
  const coreDir = join(repo, 'packages', 'core');
  const base = JSON.parse(readFileSync(join(repo, 'tsconfig.base.json'), 'utf8')) as {
    compilerOptions: object;
  };
  // The modules see the core through its declarations, as a published package does.
  write(
    join(root, 'tsconfig.base.json'),
    json({
      compilerOptions: {
        ...base.compilerOptions,
        customConditions: [],
        typeRoots: [join(repo, 'node_modules', '@types')],
      },
    }),
  );
  const ids = Array.from({ length: count }, (_, i) => pad(i + 1));
  for (let i = 1; i <= count; i++) {
    const current = names(i);
    const dir = join(root, 'packages', `m${current.n}`);
    const deps = [current.prev, current.prev2].filter((d): d is string => d !== null);
    write(
      join(dir, 'package.json'),
      json({
        name: `@synthetic/m${current.n}`,
        private: true,
        type: 'module',
        exports: {
          '.': {
            '@synthetic/source': './src/module.generated.ts',
            types: './dist/module.generated.d.ts',
            default: './dist/module.generated.js',
          },
        },
        dependencies: Object.fromEntries([
          [core, 'workspace:*'],
          ...deps.map((d) => [`@synthetic/m${d}`, 'workspace:*']),
        ]),
      }),
    );
    write(
      join(dir, 'tsconfig.json'),
      json({
        extends: '../../tsconfig.base.json',
        compilerOptions: { rootDir: 'src', outDir: 'dist' },
        include: ['src'],
        references: [{ path: coreDir }, ...deps.map((d) => ({ path: `../m${d}` }))],
      }),
    );
    link(join(dir, 'node_modules', '@keelwerk', 'core'), coreDir);
    for (const d of deps) {
      link(join(dir, 'node_modules', '@synthetic', `m${d}`), join(root, 'packages', `m${d}`));
    }
    const sources = parts(current);
    for (const [path, part] of Object.entries(sources)) {
      write(join(dir, 'src', path), `${part.imports.join('\n')}\n\n${part.body}\n`);
    }
    const moduleBase = baseSource(current);
    write(join(dir, 'src', 'base.ts'), `${moduleBase.imports.join('\n')}\n\n${moduleBase.body}\n`);
    const scanned = scanModuleDirectory(['base.ts', ...Object.keys(sources)]);
    write(
      join(dir, 'src', 'module.generated.ts'),
      renderModuleManifest({
        id: `m${current.n}`,
        generatorVersion: version,
        scanned,
        migrations: false,
      }),
    );
  }
  const app = join(root, 'app');
  write(join(app, 'package.json'), json({ name: '@synthetic/app', private: true, type: 'module' }));
  write(
    join(app, 'tsconfig.json'),
    json({
      extends: '../tsconfig.base.json',
      compilerOptions: { rootDir: 'src', outDir: 'dist' },
      include: ['src'],
      references: [{ path: coreDir }, ...ids.map((d) => ({ path: `../packages/m${d}` }))],
    }),
  );
  link(join(app, 'node_modules', '@keelwerk', 'core'), coreDir);
  for (const d of ids) {
    link(join(app, 'node_modules', '@synthetic', `m${d}`), join(root, 'packages', `m${d}`));
  }
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
    json({
      files: [],
      references: [...ids.map((d) => ({ path: `packages/m${d}` })), { path: 'app' }],
    }),
  );
  write(
    join(root, 'tsconfig.mono.json'),
    json({
      extends: './tsconfig.base.json',
      compilerOptions: {
        composite: false,
        declaration: false,
        declarationMap: false,
        sourceMap: false,
        noEmit: true,
        // Modules from source, the core from its declarations.
        customConditions: ['@synthetic/source'],
      },
      include: ['packages/*/src', 'app/src'],
    }),
  );
}
