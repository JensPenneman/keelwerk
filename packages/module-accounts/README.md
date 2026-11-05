# @keelwerk/module-accounts

The directory of people. It needs no login and knows nothing about authentication; `@keelwerk/module-auth` builds on it.

- `accounts.profile`: a chain entity that is its own data subject. `email` is unique, personal (normalised as an e-mail address, prefix-searchable) and maskable; `displayName` is plaintext; `locale` defaults to `nl-BE`; `deactivatedAt` is set by the `deactivated` event.
- `accounts.register`: creates a profile. Public, but refused as `forbidden` unless the backend configuration `allowSelfRegistration` is on (default off). A taken address is `accounts.email_taken`.
- `accounts.profile.deactivate`: the entity command behind the `deactivated` event. The deny rule `frozen` keeps a deactivated profile read-only.
- `accounts.profile.search`: matches the display name or the start of the e-mail address (three characters at least). Until prefix tags exist the start-of-address match takes the kernel's bounded scan.
- `accounts.identities`: reads the `identityProviders` extension point; empty while no login module fills it.
- `findByEmail`: a service for dependants.

Operators (`core.operator`) may do everything on profiles. The `directory` role reads profiles without their maskable e-mail address.

`src/module.generated.ts` is produced by `pnpm manifests` and the files under `migrations/own/` by `pnpm fixtures:migrations`; neither is edited by hand.
