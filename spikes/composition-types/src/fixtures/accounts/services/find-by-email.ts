import { defineService } from '../../../define-service.ts';
import { accountsBase } from '../base.ts';

export const findByEmail = defineService(accountsBase, (own, email: string) =>
  own.load.accounts.profile.one({ where: { email } }),
);
