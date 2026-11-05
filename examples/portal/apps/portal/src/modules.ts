import { accounts } from '@keelwerk/module-accounts';
import { auth } from '@keelwerk/module-auth';
import { rest } from '@keelwerk/transport-rest';

export const modules = [accounts, auth, rest] as const;
