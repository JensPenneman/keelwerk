/** Where REST puts an action (16.5.1), written down for the actions the suite calls. */
export interface RestRoute {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** `:id` takes the input's `id`. */
  readonly path: string;
  /** The input travels in the query string (a query without a filter). */
  readonly query?: true;
  /** The body is the input's `patch` (merge patch); `id` is the path's and `ifVersion` is `If-Match`. */
  readonly patch?: true;
}

export const restRoutes: Readonly<Record<string, RestRoute>> = {
  'core.capabilities': { method: 'GET', path: '/api/core/capabilities', query: true },
  'core.me': { method: 'GET', path: '/api/core/me', query: true },
  'library.addBook': { method: 'POST', path: '/api/library/add-book' },
  'library.book.archive': { method: 'DELETE', path: '/api/library/books/:id' },
  'library.book.create': { method: 'POST', path: '/api/library/books' },
  'library.book.query': { method: 'POST', path: '/api/library/books/query' },
  'library.book.reserve': { method: 'POST', path: '/api/library/books/:id/reserve' },
  'library.book.restore': { method: 'POST', path: '/api/library/books/:id/restore' },
  'library.book.update': { method: 'PATCH', path: '/api/library/books/:id', patch: true },
  'library.findByIsbn': { method: 'GET', path: '/api/library/find-by-isbn', query: true },
  'loans.about': { method: 'GET', path: '/api/loans/about', query: true },
  'loans.closeAll': { method: 'POST', path: '/api/loans/close-all' },
  'loans.lend': { method: 'POST', path: '/api/loans/lend' },
  'loans.openDesk': { method: 'POST', path: '/api/loans/open-desk' },
  'loans.loan.query': { method: 'POST', path: '/api/loans/loans/query' },
};
