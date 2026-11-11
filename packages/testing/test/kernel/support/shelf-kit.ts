import type { Outcome } from '@keelwerk/core';
import {
  defineApiVersions,
  defineApp,
  defineCommand,
  defineEntity,
  defineError,
  defineModule,
  defineModuleBase,
  defineRule,
  defineVersionChange,
  errors,
  field,
  shape,
} from '@keelwerk/core';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import type { TestPrincipal } from '../../../src/harness/test-principal.ts';

const item = defineEntity({
  prefix: 'itm',
  fields: {
    label: field.string().index(),
    size: field.integer().default(1),
    note: field.string().optional().maskable().index(),
  },
});
const base = defineModuleBase({ id: 'shelf', version: '2.0.0', entities: { item } });

const full = defineError('shelf.full', { kind: 'conflict', message: 'The shelf is full.' });

const place = defineCommand(base, {
  input: shape({}),
  output: shape({}),
  errors: [full],
  principal: 'user',
  decide: () => {
    throw full();
  },
});

const restock = defineCommand(base, item, {
  input: shape({ label: field.string() }),
  execution: 'async',
  principal: 'user',
  decide: (input, current, ctx) => [ctx.write.shelf.item.update(current, { label: input.label })],
});

/** Refuses with issues that name head fields, the way a `decide` does: past the translation. */
const claim = defineCommand(base, item, {
  input: shape({ label: field.string(), size: field.integer() }),
  principal: 'user',
  decide: () => {
    throw errors.validation('The claim is refused.', {
      issues: [
        { path: ['label'], message: 'is taken' },
        { path: ['size'], message: 'is too small' },
      ],
    });
  },
});

const allIds = [
  'shelf.colourRemoved',
  'shelf.labelRename',
  'shelf.noteRename',
  'shelf.placeRename',
  'shelf.sizeAdded',
];

/** The removed `colour` of `shelf.item.get`, built from one member of the row in the names the older caller knows. */
export function colourFrom(member: 'title' | 'memo') {
  return defineVersionChange(base, {
    since: '2.0.0',
    surface: [{ entity: item, field: 'colour', removed: true }],
    output: {
      'shelf.item.get': (value: unknown) => {
        const page = value as { readonly list: readonly Record<string, unknown>[] };
        return {
          ...page,
          list: page.list.map((row) => ({ ...row, colour: `${String(row[member])}-grey` })),
        };
      },
    },
  });
}

/** Like `colourFrom('memo')`, but a row that lists `memo` in `$masked` gets no colour (left undefined, so it is named hidden). */
export function colourFromMemoUnlessMasked() {
  return defineVersionChange(base, {
    since: '2.0.0',
    surface: [{ entity: item, field: 'colour', removed: true }],
    output: {
      'shelf.item.get': (value: unknown) => {
        const page = value as { readonly list: readonly Record<string, unknown>[] };
        return {
          ...page,
          list: page.list.map((row) => ({
            ...row,
            colour:
              Array.isArray(row.$masked) && row.$masked.includes('memo')
                ? undefined
                : `${String(row.memo)}-grey`,
          })),
        };
      },
    },
  });
}

/** The four kinds of change in one module, each as its own part, plus a rename of a maskable field. */
export function shelfChanges(extra: Readonly<Record<string, object>> = {}) {
  return {
    labelRename: defineVersionChange(base, {
      since: '2.0.0',
      surface: [{ entity: item, field: 'label', renamedFrom: 'title' }],
    }),
    noteRename: defineVersionChange(base, {
      since: '2.0.0',
      surface: [{ entity: item, field: 'note', renamedFrom: 'memo' }],
    }),
    sizeAdded: defineVersionChange(base, {
      since: '2.0.0',
      surface: [{ entity: item, field: 'size', addedRequired: true }],
    }),
    colourRemoved: defineVersionChange(base, {
      since: '2.0.0',
      surface: [{ entity: item, field: 'colour', removed: true }],
      output: {
        'shelf.item.get': (value: unknown) => {
          const page = value as { readonly list: readonly object[] };
          return { ...page, list: page.list.map((row) => ({ ...row, colour: 'grey' })) };
        },
      },
    }),
    placeRename: defineVersionChange(base, {
      since: '2.0.0',
      surface: [{ action: 'shelf.place', renamedFrom: 'shelf.put' }],
      errors: { 'shelf.full': 'shelf.no_room' },
    }),
    ...extra,
  } as never;
}

/** The shelf app: `2026-11-04` adopts nothing, `2026-11-11` adopts the changes given (default: all). */
export function shelfAppOf(changes: object = shelfChanges(), adopted: readonly string[] = allIds) {
  const shelf = defineModule(base, {
    actions: { place },
    entityActions: { item: { restock, claim } },
    changes,
    policies: {
      item: {
        readers: defineRule(base, item, {
          effect: 'allow',
          actions: ['read'],
          principal: 'user',
          where: (ctx) => (ctx.principal.claims.admin === true ? false : {}),
          fields: [],
        }),
        admins: defineRule(base, item, {
          effect: 'allow',
          actions: ['read'],
          principal: 'user',
          where: (ctx) => (ctx.principal.claims.admin === true ? {} : false),
        }),
        writers: defineRule(base, item, {
          effect: 'allow',
          actions: ['write', 'restock', 'claim'],
          principal: 'user',
        }),
      },
      place: { signedIn: defineRule(base, place, { effect: 'allow', principal: 'user' }) },
    },
  } as never);
  return defineApp({
    id: 'shelves',
    modules: [shelf],
    api: defineApiVersions({ '2026-11-04': {}, '2026-11-11': { changes: adopted } }),
  } as never);
}

export type ShelfApp = ReturnType<typeof shelfAppOf>;

/** A running shelf app and a caller that names the API version of each request. */
export async function bootShelf(app: ShelfApp = shelfAppOf(), workers = false) {
  const runtime = await startTestRuntime(app as never, {
    tenants: ['acme'],
    ...(workers ? { workers: true as const } : {}),
  });
  const tenant = runtime.tenants.acme;
  const call = (
    version: string | undefined,
    who: TestPrincipal,
    action: string,
    input: unknown,
    options: { readonly prefer?: 'async'; readonly commandId?: string } = {},
  ) => {
    const carrier = testCarrier(tenant, who);
    return runtime.invoker.invoke<unknown, Record<string, unknown>>({
      action,
      input,
      carrier:
        version === undefined
          ? carrier
          : { ...carrier, headers: { ...carrier.headers, 'keelwerk-version': version } },
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId: options.commandId ?? crypto.randomUUID(),
      ...(options.prefer === undefined ? {} : { prefer: options.prefer }),
    });
  };
  return { runtime, call };
}

/** The `id` of the row a successful create answered. */
export function idOf(outcome: Outcome<unknown>): string {
  if (!outcome.ok) throw outcome.error;
  return (outcome.value as { id: string }).id;
}
