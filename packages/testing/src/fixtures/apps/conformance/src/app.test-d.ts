import type { ActionRef, AppActionTree, Row } from '@keelwerk/core';
import { describe, expectTypeOf, test } from 'vitest';
import type { Conformance } from './app.ts';

describe('the conformance fixture app', () => {
  test('gives the book the field loans contributes', () => {
    expectTypeOf<Row<Conformance, 'library.book'>['reservedBy']>().not.toBeNever();
    expectTypeOf<'library.book.reserve'>().toExtend<ActionRef<Conformance>>();
  });

  test('the conditional part for the library adds the loan field, and live is absent', () => {
    expectTypeOf<Row<Conformance, 'loans.loan'>>().toHaveProperty('bookId');
    expectTypeOf<'loans.loanEvents'>().not.toExtend<ActionRef<Conformance>>();
  });

  test('carries the execution mode after the override', () => {
    expectTypeOf<
      AppActionTree<Conformance>['loans']['actions']['lend']['execution']
    >().toEqualTypeOf<'sync'>();
    expectTypeOf<
      AppActionTree<Conformance>['loans']['actions']['closeAll']['execution']
    >().toEqualTypeOf<'async'>();
  });
});
