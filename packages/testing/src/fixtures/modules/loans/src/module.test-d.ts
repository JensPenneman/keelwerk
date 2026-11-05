import { defineModule } from '@keelwerk/core';
import { describe, expectTypeOf, test } from 'vitest';
import type { Loans } from '../../../index.ts';
import { about } from './actions/about.ts';
import { closeAll } from './actions/close-all.ts';
import { lend } from './actions/lend.ts';
import { openDesk } from './actions/open-desk.ts';
import { loansBase } from './base.ts';
import { countLoans } from './conditional/when-library/reactions/count-loans.ts';
import { loanEvents } from './conditional/when-live/actions/loan-events.ts';
import { reserve } from './contributions/to-library/actions/book/reserve.ts';
import { reservers } from './contributions/to-library/policies/book/reservers.ts';
import { staff } from './policies/close-all/staff.ts';
import { signedIn } from './policies/lend/signed-in.ts';
import { auditors } from './policies/loan/auditors.ts';
import { borrowers } from './policies/loan/borrowers.ts';

describe('the loans fixture manifest', () => {
  test('has the type of the same module written in one file', () => {
    const written = defineModule(loansBase, {
      actions: { about, closeAll, lend, openDesk },
      policies: { closeAll: { staff }, lend: { signedIn }, loan: { auditors, borrowers } },
      contributes: {
        toLibrary: { entityActions: { book: { reserve } }, policies: { book: { reservers } } },
      },
      conditional: {
        whenLibrary: { reactions: { countLoans } },
        whenLive: { actions: { loanEvents } },
      },
    });
    expectTypeOf<Loans>().toEqualTypeOf<typeof written>();
  });
});
