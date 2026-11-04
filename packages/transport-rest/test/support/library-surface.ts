import type { ApiSurface, SurfaceAction, SurfaceEntity } from '@keelwerk/core';
import {
  action,
  anyJson,
  id,
  int,
  list,
  none,
  oneOf,
  pageOf,
  plain,
  readOnly,
  shape,
  str,
} from './nodes.ts';

const page = {
  sortable: ['title'],
  defaultSort: [{ field: 'title', direction: 'asc' as const }],
  defaultSize: 25,
  maxSize: 100,
};

const book: SurfaceEntity = {
  ref: 'library.book',
  module: 'library',
  name: 'book',
  prefix: 'bk',
  history: 'chain',
  tenancy: 'tenant',
  fields: {
    id: id('library.book', 'bk'),
    version: readOnly('serial'),
    createdAt: readOnly('instant'),
    title: { ...str({ maxLength: 120 }), description: 'The title.', maskable: true },
    isbn: { ...str(), unique: true },
    pages: int({ optional: true }),
    status: oneOf('available', 'lent', 'lost'),
    publishedOn: plain('date', true),
    tags: list(str(), true),
    author: id('library.author', 'au', 'ref'),
    reviewer: { ...str({ optional: true }), personal: true },
    notes: anyJson(),
  },
  relations: { author: { kind: 'one', target: 'library.author' } },
  generated: [
    'get',
    'query',
    'changes',
    'queryChanges',
    'create',
    'update',
    'archive',
    'restore',
    'set',
    'watch',
    'history',
  ],
  page,
  origin: {},
  description: 'A book in the library.',
};

const author: SurfaceEntity = {
  ref: 'library.author',
  module: 'library',
  name: 'author',
  prefix: 'au',
  history: 'state',
  tenancy: 'tenant',
  fields: { id: id('library.author', 'au'), name: str() },
  relations: { books: { kind: 'many', target: 'library.book', by: 'author' } },
  generated: ['get', 'query'],
  page,
  origin: {},
};

const shelf: SurfaceEntity = {
  ref: 'library.shelf',
  module: 'library',
  name: 'shelf',
  prefix: 'sh',
  history: 'state',
  tenancy: 'tenant',
  fields: { id: id('library.shelf', 'sh'), label: str() },
  relations: {},
  generated: ['get'],
  page,
  origin: {},
};

const row = shape({ id: id('library.book', 'bk'), title: str() });
const filterInput = {
  filter: anyJson(),
  first: int({ optional: true }),
  after: str({ optional: true }),
};
const queryInput = shape({
  ...filterInput,
  sort: list(str(), true),
  fields: list(str(), true),
});

const generated = (
  name: string,
  extra: Partial<SurfaceAction> & Pick<SurfaceAction, 'kind' | 'input' | 'output'>,
) => action(`library.book.${name}`, { mount: 'entity', generated: name, ...extra });

const actions: SurfaceAction[] = [
  generated('get', {
    kind: 'query',
    input: shape({ ids: list(id('library.book', 'bk')), fields: list(str(), true) }),
    output: shape({ list: list(row), notFound: list(str()), state: str() }),
  }),
  generated('query', { kind: 'query', input: queryInput, output: pageOf(row) }),
  generated('changes', {
    kind: 'query',
    input: shape({ since: str(), max: int({ optional: true }) }),
    output: shape({ oldState: str(), newState: str(), created: list(str()) }),
  }),
  generated('queryChanges', {
    kind: 'query',
    input: shape({ filter: anyJson(), sinceQueryState: str() }),
    output: shape({ oldQueryState: str(), newQueryState: str() }),
  }),
  generated('create', {
    kind: 'command',
    input: shape({ title: str(), isbn: str(), pages: int({ optional: true }) }),
    output: row,
    execution: 'either',
    idempotent: true,
    errors: ['library.isbn_taken'],
  }),
  generated('update', {
    kind: 'command',
    instance: true,
    input: shape({
      id: id('library.book', 'bk'),
      ifVersion: int({ optional: true }),
      title: str({ optional: true }),
    }),
    output: row,
    errors: ['core.version_mismatch', 'library.isbn_taken'],
  }),
  generated('archive', {
    kind: 'command',
    instance: true,
    input: shape({ id: id('library.book', 'bk') }),
    output: row,
  }),
  generated('restore', {
    kind: 'command',
    instance: true,
    input: shape({ id: id('library.book', 'bk') }),
    output: row,
  }),
  generated('set', {
    kind: 'command',
    input: shape({ create: list(shape({ title: str() }), true) }),
    output: shape({ created: list(str()) }),
  }),
  generated('watch', { kind: 'subscription', input: shape({ filter: anyJson() }), output: row }),
  generated('history', {
    kind: 'query',
    instance: true,
    input: shape({ id: id('library.book', 'bk') }),
    output: shape({ entries: list(str()) }),
  }),
  action('library.book.checkOut', {
    mount: 'entity',
    kind: 'command',
    instance: true,
    input: shape({ id: id('library.book', 'bk'), until: plain('date') }),
    output: none,
    execution: 'either',
    errors: ['library.already_lent'],
    description: 'Lends the book.',
  }),
  action('library.book.search', {
    mount: 'entity',
    kind: 'query',
    input: shape({ text: str(), statuses: list(oneOf('available', 'lent'), true) }),
    output: pageOf(row),
  }),
  action('library.book.report', {
    mount: 'entity',
    kind: 'query',
    input: shape({ ranges: list(shape({ from: plain('date'), to: plain('date') })) }),
    output: shape({ total: int() }),
    scope: 'backend',
  }),
  action('library.author.get', {
    mount: 'entity',
    kind: 'query',
    generated: 'get',
    input: shape({ ids: list(id('library.author', 'au')) }),
    output: shape({ list: list(shape({ id: id('library.author', 'au') })) }),
  }),
  action('library.author.query', {
    mount: 'entity',
    kind: 'query',
    generated: 'query',
    input: queryInput,
    output: pageOf(shape({ id: id('library.author', 'au') })),
  }),
  action('library.shelf.get', {
    mount: 'entity',
    kind: 'query',
    generated: 'get',
    input: shape({ ids: list(id('library.shelf', 'sh')) }),
    output: shape({ list: list(shape({ id: id('library.shelf', 'sh') })) }),
    hints: { rest: { collection: 'shelves' } },
  }),
  action('library.register', {
    mount: 'module',
    kind: 'command',
    input: shape({ email: str({ format: 'email' }) }),
    output: none,
    execution: 'async',
    idempotent: true,
    contributedBy: 'accounts',
    deprecated: { reason: 'use accounts.register' },
  }),
  action('library.stats', {
    mount: 'module',
    kind: 'query',
    input: none,
    output: shape({ books: int() }),
  }),
  action('library.events', { mount: 'module', kind: 'subscription', input: none, output: row }),
  action('library.internal', {
    mount: 'module',
    kind: 'query',
    input: none,
    output: none,
    hints: { rest: { expose: false } },
  }),
  action('app.health', {
    mount: 'app',
    kind: 'query',
    input: none,
    output: shape({ ok: plain('boolean') }),
    auth: 'public',
    scope: 'deployment',
  }),
  action('core.me', {
    mount: 'module',
    kind: 'query',
    input: none,
    output: shape({ subject: str() }),
    errors: ['core.version_mismatch'],
  }),
].sort((left, right) => (left.ref < right.ref ? -1 : 1));

/** A hand-written surface exercising every route family of section 16.5.1. */
export const librarySurface: ApiSurface = {
  format: 'keelwerk.surface/1',
  app: 'library',
  apiVersion: '2026-11-01',
  hash: 'sha256-libraryFixture',
  modules: [
    { id: 'app', version: '0.0.0' },
    { id: 'core', version: '0.0.0' },
    { id: 'library', version: '0.1.0', description: 'Lending.' },
  ],
  entities: [author, book, shelf],
  actions,
  errors: [
    {
      code: 'core.version_mismatch',
      kind: 'conflict',
      message: 'The row changed since you read it.',
      retryable: false,
    },
    {
      code: 'library.already_lent',
      kind: 'conflict',
      message: 'The book is already lent.',
      retryable: false,
      data: shape({ since: plain('instant') }),
    },
    {
      code: 'library.isbn_taken',
      kind: 'conflict',
      message: 'The ISBN exists.',
      retryable: false,
    },
  ],
  events: [],
};
