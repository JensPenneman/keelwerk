import { jobStoreCases } from '@keelwerk/testing';
import { storeSuite } from './support/store-suite.ts';

const store = storeSuite();

// The cases read and move time on the fixture clock the adapter's units see.
jobStoreCases({
  run: async (scope, fn) => store.run(scope, fn),
  clock: { now: () => store.clock.now(), advance: (ms) => store.clock.advance(ms) },
});
