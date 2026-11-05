import { defineService } from '@keelwerk/core';
import { accountsBase } from '../base.ts';

/** Whether self-registration is open: the module's `allowSelfRegistration` setting (17.2.1). */
export const registrationOpen = defineService(accountsBase, function* (own) {
  yield* [];
  return own.config.allowSelfRegistration;
});
