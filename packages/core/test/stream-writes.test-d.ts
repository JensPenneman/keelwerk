import { describe, expectTypeOf, test } from 'vitest';
import type { WritesOf } from '../src/contexts/writes-of.ts';
import type { Id } from '../src/ids/id.ts';
import type { StreamAppendDraft } from '../src/protocol/stream-append-draft.ts';
import type { M2PartsBase } from './fixtures/modules/m2-parts/src/base.ts';

type Log = WritesOf<M2PartsBase, never>['m2Parts']['log'];
declare const log: Log;
declare const id: Id<'m2-parts.task'>;

describe('ctx.write.<module>.<stream>', () => {
  test('append takes the keyed id and records of the shape', () => {
    expectTypeOf<Log['append']>().parameter(0).toEqualTypeOf<Id<'m2-parts.task'>>();
    expectTypeOf<Log['append']>()
      .parameter(1)
      .toEqualTypeOf<readonly { readonly line: string }[]>();
    expectTypeOf<Log['append']>().returns.toEqualTypeOf<StreamAppendDraft>();
    log.append(id, [{ line: 'a' }]);
    // @ts-expect-error a wrong member
    log.append(id, [{ text: 'a' }]);
    // @ts-expect-error a plain string is no id
    log.append('tsk_1', [{ line: 'a' }]);
  });
});
