import { defineApp } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';
import { auth } from '@keelwerk/module-auth';

/**
 * The portal's own modules without the REST transport, which needs the HTTP host: the app the
 * in-process harness runs for the tests that call the invoker and the store directly.
 */
export const localApp = defineApp({ id: 'portal', modules: [accounts, auth] as const });
