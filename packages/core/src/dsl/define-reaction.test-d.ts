import { describe, expectTypeOf, test } from 'vitest';
import type { JobRetry } from '../jobs/job-retry.ts';
import type { ReactionSpec } from './define-reaction.ts';

declare const base: never;

describe('the options of an async reaction', () => {
  test('ordering, coalesce, concurrency and retry are typed for async', () => {
    type Async = ReactionSpec<typeof base, 'all', 'async'>;
    expectTypeOf<Async['ordering']>().toEqualTypeOf<'none' | 'fifo-per-key' | undefined>();
    expectTypeOf<Async['coalesce']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Async['concurrency']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Async['retry']>().toEqualTypeOf<JobRetry | undefined>();
  });

  test('an inline reaction takes none of them', () => {
    type Inline = ReactionSpec<typeof base, 'all', 'inline'>;
    expectTypeOf<Inline['ordering']>().toEqualTypeOf<undefined>();
    expectTypeOf<Inline['coalesce']>().toEqualTypeOf<undefined>();
    expectTypeOf<Inline['concurrency']>().toEqualTypeOf<undefined>();
    expectTypeOf<Inline['retry']>().toEqualTypeOf<undefined>();
  });
});
