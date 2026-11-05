import type { MigrationFile } from '@keelwerk/core';

export const migration: MigrationFile = {
  id: '0001-initial',
  steps: [
    {
      column: {
        constraints: {},
        default: null,
        field: 'lastLoginAt',
        kind: 'instant',
        name: 'last_login_at',
        nullable: true,
      },
      entity: 'accounts.profile',
      field: 'lastLoginAt',
      op: 'addColumn',
    },
    {
      column: {
        constraints: {},
        default: null,
        field: 'emailVerifiedAt',
        kind: 'instant',
        name: 'email_verified_at',
        nullable: true,
      },
      entity: 'accounts.profile',
      field: 'emailVerifiedAt',
      op: 'addColumn',
    },
  ],
  track: 'auth->accounts',
};
