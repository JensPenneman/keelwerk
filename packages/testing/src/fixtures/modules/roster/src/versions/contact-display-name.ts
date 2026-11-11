import { defineVersionChange } from '@keelwerk/core';
import { rosterBase } from '../base.ts';
import { contact } from '../entities/contact.ts';

export const contactDisplayName = defineVersionChange(rosterBase, {
  since: '1.0.0',
  surface: [{ entity: contact, field: 'displayName', renamedFrom: 'name' }],
  fixtures: [
    { ref: 'roster.contact.create', older: { name: 'Ada' }, newer: { displayName: 'Ada' } },
  ],
});
