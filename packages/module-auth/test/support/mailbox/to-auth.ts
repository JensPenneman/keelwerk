import { defineContribution } from '@keelwerk/core';
import { auth } from '../../../src/module.generated.ts';

/** What the test mailbox adds to auth: a delivery filler for reset links. */
export const toAuth = defineContribution(auth, {});
