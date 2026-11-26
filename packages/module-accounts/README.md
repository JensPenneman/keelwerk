# @keelwerk/module-accounts

The directory of people. It needs no login and knows nothing about authentication; `@keelwerk/module-auth` builds on it.

- `accounts.profile`: a chain entity that is its own data subject. `email` is unique, personal (normalised as an e-mail address, prefix-searchable) and maskable; `displayName` is plaintext; `locale` defaults to `nl-BE`; `deactivatedAt` is set by the `deactivated` event.
- `accounts.register`: creates a profile. Public, but refused as `forbidden` unless the backend configuration `allowSelfRegistration` is on (default off). A taken address is `accounts.email_taken`.
- `accounts.profile.deactivate`: the entity command behind the `deactivated` event. The deny rule `frozen` keeps a deactivated profile read-only. The principal enricher `accounts.deactivated` refuses, as `unauthenticated`, a user whose `subjectAs('accounts.profile')` names a deactivated profile, at a request, the revalidation of a stream and a job; a redeemed ticket answers `core.ticket_invalid`. It judges the mark within a tenant and does nothing at a scope without one.
- A deactivation is final in this version: no command clears it, and only `deactivate` writes `deactivatedAt`. That finality rests on two rules, `frozen` (a deactivated profile cannot be deactivated again, updated or archived, and a profile cannot be created marked; restoring it stays allowed) and `mark` (no generated write changes `deactivatedAt`); an app that disables either takes the finality on itself. A command another module adds to the profile later is outside what the rules name, and so is a write straight to the database. The refusal is judged within the profile's tenant, for a profile that is neither archived nor erased: a principal that names it in another tenant is not judged there; after the erasure of the subject an app's own resolver that still answers for it is served; a profile deactivated and then archived on 0.2.0 is not judged while archived (restore or erase it).
- `accounts.profile.search`: matches the display name or the start of the e-mail address (three characters at least). Until prefix tags exist the start-of-address match takes the kernel's bounded scan.
- `accounts.identities`: reads the `identityProviders` extension point; empty while no login module fills it.
- `findByEmail`: a service for dependants.

Operators (`core.operator`) may do everything on profiles. No role grants a read: any module can add a role to a principal, so this module decides by none. An application that wants a directory adds its own rule in `defineApp`. Its condition rests on a membership of the application's own kind (here `readers.directory`, which the kernel takes only from the application's module `readers`), and `fields: []` keeps the e-mail address out. A case of this package runs exactly this rule:

```ts
defineApp({
  id: 'my-app',
  modules: [accounts, readers],
  policies: {
    add: [
      {
        id: 'readers.profile.directory',
        module: 'readers',
        effect: 'allow',
        subject: { module: 'accounts', entity: 'profile' },
        actions: ['read', 'search'],
        principal: 'user',
        where: (ctx: { principal: { memberships: readonly { kind: string }[] } }) =>
          ctx.principal.memberships.some((membership) => membership.kind === 'readers.directory'),
        fields: [],
        reason: 'The application lets the readers of its directory browse people by name.',
        disabled: false,
      },
    ],
  },
});
```

An application that instead grants by a role reads `ctx.principal.roles` in its own rule and then trusts every fill it composes, because any module's enricher or resolver can add any role.

An application that lists `accounts.profile.directory` in `policies.disable` no longer composes (`unknownDisabledRule`) and drops that name.

Limitations: the e-mail match of `accounts.profile.search` follows what the caller's read plan reveals, so today only operators get it; no shipped rule gives the administrators of 17.2.1, or a member of `@keelwerk/module-members`, a read: an application grants it by its own rule.

`src/module.generated.ts` is produced by `pnpm manifests` and the files under `migrations/own/` by `pnpm fixtures:migrations`; neither is edited by hand.
