import { describe, test } from 'vitest';
import {
  asyncStoredBytes,
  erasureStoredBytes,
  hooksStoredBytes,
  journalStoredBytes,
  receiptStoredBytes,
  relayStoredBytes,
} from './support/stored-bytes-cases.ts';

describe.each(['memory', 'pglite'] as const)(
  'core.eventBytes counts what is stored on %s',
  (adapter) => {
    test(
      'the hooks app: decision records with request and prepare, effect records and attempts',
      {
        timeout: 120_000,
      },
      () => hooksStoredBytes({ adapter }),
    );

    test(
      'the journal app: module stream records and an inline reaction that appends one',
      {
        timeout: 120_000,
      },
      () => journalStoredBytes({ adapter }),
    );

    test(
      'an asynchronous command and its job: change records counted, given back by the sweep',
      {
        timeout: 120_000,
      },
      () => asyncStoredBytes({ adapter }),
    );

    test(
      'an erasure that purges keyed stream records gives their bytes back',
      {
        timeout: 120_000,
      },
      () => erasureStoredBytes({ adapter }),
    );

    test(
      'the relay app: inline and asynchronous reactions, the process stream',
      {
        timeout: 120_000,
      },
      () => relayStoredBytes({ adapter }),
    );
  },
);

test('the change record of an accepted command is stored and counted', () => receiptStoredBytes());
