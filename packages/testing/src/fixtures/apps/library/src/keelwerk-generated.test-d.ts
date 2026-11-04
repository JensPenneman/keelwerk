import { describe, expectTypeOf, test } from 'vitest';
import type {
  ActionRef as ConformanceActionRef,
  Actions as ConformanceActions,
  App as ConformanceApp,
  Client as ConformanceClient,
  Entities as ConformanceEntities,
  RowOf as ConformanceRowOf,
} from '../../conformance/src/keelwerk.generated.ts';
import type { Library } from './app.ts';
import type { ActionRef, Actions, App, Client, Entities, RowOf } from './keelwerk.generated.ts';

describe('the generated files of the fixture apps (section 13.7)', () => {
  test('re-export the app type fold of the library app', () => {
    expectTypeOf<App>().toEqualTypeOf<Library>();
    expectTypeOf<'library.addBook'>().toExtend<ActionRef>();
    expectTypeOf<keyof Entities>().toExtend<string>();
    expectTypeOf<keyof Actions>().toExtend<string>();
    expectTypeOf<RowOf<'library.book'>>().toExtend<object>();
    expectTypeOf<Client>().toHaveProperty('invoke');
  });

  test('re-export the app type fold of the conformance app', () => {
    expectTypeOf<ConformanceActionRef>().toExtend<string>();
    expectTypeOf<keyof ConformanceEntities>().toExtend<string>();
    expectTypeOf<keyof ConformanceActions>().toExtend<string>();
    expectTypeOf<ConformanceRowOf<'loans.loan'>>().toExtend<object>();
    expectTypeOf<ConformanceClient>().toHaveProperty('invoke');
    expectTypeOf<ConformanceApp>().toExtend<object>();
  });
});
