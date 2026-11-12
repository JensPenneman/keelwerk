import {
  contracts,
  defineApiVersions,
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  defineSubscription,
  defineVersionChange,
  field,
  type ModuleBaseType,
  type ModuleType,
  mapItems,
  shape,
} from '@keelwerk/core';
import { live } from '@keelwerk/live';

const contact = defineEntity({
  prefix: 'ctc',
  fields: { displayName: field.string({ maxLength: 100 }) },
});

interface ContactsBase extends ModuleBaseType<typeof contactsBaseDef> {}

const contactsBaseDef = defineModuleBase({
  id: 'contacts',
  version: '1.0.0',
  requires: [contracts.live],
  entities: { contact },
});
const contactsBase: ContactsBase = contactsBaseDef;

/** What a subscriber is told of each contact that changes, at the head. */
const contactEvents = defineSubscription(contactsBase, {
  event: shape({ contactId: field.ref.own('contact'), displayName: field.string() }),
  principal: 'user',
  source: (_input, ctx, resume) =>
    mapItems(ctx.live.entity('contacts', 'contact', { after: resume }), (change) =>
      change.type === 'removed'
        ? undefined
        : {
            contactId: change.id,
            displayName: (change.row as { readonly displayName: string }).displayName,
          },
    ),
});

const label = 'was:';

const labelChange = defineVersionChange(contactsBase, {
  since: '1.0.0',
  surface: [],
  output: {
    'contacts.contactEvents': (value: unknown) => {
      const event = value as { readonly displayName: string };
      return { ...event, displayName: `${label}${event.displayName}` };
    },
  },
});

const contactsDef = defineModule(contactsBase, {
  actions: { contactEvents },
  policies: {
    contact: {
      editors: defineRule(contactsBase, contact, {
        effect: 'allow',
        actions: ['read', 'write'],
        principal: 'user',
        reason: 'A signed-in user reads and edits contacts.',
      }),
    },
    contactEvents: {
      users: defineRule(contactsBase, contactEvents, { effect: 'allow', principal: 'user' }),
    },
  },
  changes: { labelChange },
});

interface Contacts extends ModuleType<typeof contactsDef> {}
const contacts: Contacts = contactsDef;

/** The label the older version puts in front of every name: a transform that runs twice shows it twice. */
export const olderLabel = label;

/** The API version before and at the head of `labelledContactsApp`. */
export const contactVersions = { older: '2026-11-04', head: '2026-11-11' } as const;

/**
 * An app with the live module and one subscription, `contacts.contactEvents`, whose items a version
 * change translates: the older version sees each `displayName` with `olderLabel` in front.
 */
export const labelledContactsApp = defineApp({
  id: 'labelled-contacts',
  modules: [live, contacts],
  api: defineApiVersions({
    [contactVersions.older]: {},
    [contactVersions.head]: { changes: ['contacts.labelChange'] },
  }),
});
