import type { ActionRef, AppActionTree, Row } from '@keelwerk/core';
import { describe, expectTypeOf, test } from 'vitest';
import type { Transport } from './app.ts';
import type {
  Actions,
  App,
  Client,
  Entities,
  ActionRef as GeneratedActionRef,
  RowOf,
} from './keelwerk.generated.ts';

describe('the transport fixture app', () => {
  test('is the conformance modules: the contributed field and the actions exist', () => {
    expectTypeOf<Row<Transport, 'library.book'>['reservedBy']>().not.toBeNever();
    expectTypeOf<'library.book.reserve'>().toExtend<ActionRef<Transport>>();
    expectTypeOf<'loans.lend'>().toExtend<ActionRef<Transport>>();
  });

  test('lend runs sync or async as the caller prefers, closeAll always async', () => {
    expectTypeOf<
      AppActionTree<Transport>['loans']['actions']['lend']['execution']
    >().toEqualTypeOf<'either'>();
    expectTypeOf<
      AppActionTree<Transport>['loans']['actions']['closeAll']['execution']
    >().toEqualTypeOf<'async'>();
  });

  test('its generated file folds the same app type', () => {
    expectTypeOf<App>().toEqualTypeOf<Transport>();
    expectTypeOf<GeneratedActionRef>().toExtend<string>();
    expectTypeOf<keyof Entities>().toExtend<string>();
    expectTypeOf<keyof Actions>().toExtend<string>();
    expectTypeOf<RowOf<'loans.loan'>>().toExtend<object>();
    expectTypeOf<Client>().toHaveProperty('invoke');
  });
});
