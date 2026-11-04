import type { CommandReceipt } from '@keelwerk/core';
import type { LeafAt } from './leaf-at.ts';
import type { Prefer } from './prefer.ts';

/**
 * The result follows the effective execution mode: a query and a synchronous command give the
 * output, an asynchronous command the receipt, an `either` command the caller's preference.
 */
export type ResultOf<App, R, P extends Prefer = 'sync'> =
  LeafAt<App, R> extends { readonly kind: 'query'; readonly output: infer O }
    ? O
    : LeafAt<App, R> extends { readonly execution: 'sync'; readonly output: infer O }
      ? O
      : LeafAt<App, R> extends { readonly execution: 'async' }
        ? CommandReceipt
        : LeafAt<App, R> extends { readonly output: infer O }
          ? P extends 'async'
            ? CommandReceipt
            : O
          : never;
