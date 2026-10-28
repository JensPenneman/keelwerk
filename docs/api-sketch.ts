/**
 * keelwerk public API sketch, as seen by an application author.
 * Date: 2026-10-28 (first version 2026-10-08; rewritten in the literal form on 2026-10-24, in the
 * strict model of decision 50a on 2026-10-25, and for the decisions of 2026-10-26 to 2026-10-28:
 * one rule per file (60b), the generated manifest (59b), the Maybe accessor (32b) and Temporal
 * instants (19b)). Status: target for the spike of roadmap M0, which type-checks it as the
 * acceptance test of the DSL; it does not compile against anything yet.
 *
 * It shows: an accounts module, an authentication module that contributes to accounts and adapts
 * itself when accounts (or a live module) is present, a small module with an external effect, two
 * apps composing the first two, a deployment, rules with conditions on the row acted on and the row
 * produced, commands, queries and a subscription, and how the derived types are consumed. Every
 * module is object literals (decision point 3, decided on 2026-10-24): a module base, parts typed
 * against it, and a module literal that mounts them. In a project each part is a file of its own,
 * every rule too (decision 60b: policies/<target>/<rule>.ts, whose path gives the rule id), and the
 * generator writes the module literal as module.generated.ts from the directories (decision 59b;
 * architecture.md section 23); the sketch keeps everything in one file and writes the module
 * literals by hand, as tests and spikes may, under the keys the generator would derive from the
 * paths. Instants are Temporal.Instant values (decision 19b): Node 26 ships Temporal natively.
 *
 * Every handler is pure (decision 50a, decided on 2026-10-25; architecture.md section 7.9, "Pure
 * handlers and the effect interpreter"): a command's `decide` yields requests with `yield*` and
 * returns a decision (events, effects, result); a query's `read` returns a request or a value;
 * reactions `react`; services and fills return values or generators. Only effect executors
 * (`defineEffectExecutor`) run imperative code. The DSL is specified in architecture.md section 4,
 * the type-level model in section 4.7, authorization in section 8 and the authentication module in
 * section 17.2.
 */

import {
  contracts,
  defineApp,
  defineCommand,
  defineCondition,
  defineContribution,
  defineDeployment,
  defineEffect,
  defineEffectExecutor,
  defineEntity,
  defineError,
  defineFill,
  defineHook,
  defineModule,
  defineModuleBase,
  defineQuery,
  defineReaction,
  defineRule,
  defineService,
  defineSubscription,
  env,
  errors,
  extensionPoint,
  field,
  invoke,
  mapItems,
  outcomeOf,
  pageOf,
  relation,
  secret,
  shape,
  within,
  byHeader,
  byHostname,
  byScopeKey,
  type AppType,
  type Draft,
  type Gen,
  type Id,
  type ModuleBaseType,
  type ModuleType,
  type Row,
} from '@keelwerk/core'
import { ledgerFile } from '@keelwerk/core/ledger'
import { postgresAdapter } from '@keelwerk/adapter-postgres'
import { httpHost } from '@keelwerk/transport-http'
import { rest } from '@keelwerk/transport-rest'
import { graphql } from '@keelwerk/transport-graphql'
import { live } from '@keelwerk/live'
import type { AppClient } from '@keelwerk/client'

// ============================================================================
// 1. accounts: the lower module of the pair. It knows nothing about auth.
// ============================================================================

/** Contract of the extension point accounts declares so that login modules can describe identities. */
export interface IdentityProvider {
  readonly id: string
  readonly label: string
  /** A pure generator, bound to its contributor's context (gap G16): auth loads its own credentials here. */
  listFor(profileId: Id<'accounts.profile'>): Gen<ReadonlyArray<{ kind: string; label: string; createdAt: Temporal.Instant }>>
}

export const emailTaken = defineError('accounts.email_taken', {
  kind: 'conflict',
  message: 'This e-mail address is already in use.',
  data: shape({ email: field.string() }),
})

const profile = defineEntity({
  prefix: 'prof',
  dataSubject: 'id', // the row is the subject's own record
  fields: {
    displayName: field.string({ maxLength: 120 }).merge('lww'),
    // unique implies merge 'exclusive' and the 'eq' capability; 'email' normalises case, so uniqueness is
    // case-insensitive; 'prefix' (three characters at least) serves the search below (section 14.7.9)
    email: field.string({ format: 'email' }).unique().personal({ normalize: 'email', queries: ['prefix'] }).maskable(),
    locale: field.string().default('nl-BE'),
    deactivatedAt: field.instant().optional(),
  },
  indexes: [{ fields: ['displayName'] }],
  events: {
    deactivated: shape({ at: field.instant(), reason: field.string().optional() }),
  },
  evolve: {
    deactivated: (state, e) => ({ ...state, deactivatedAt: e.at }),
  },
  // history: 'chain' and tenancy: 'tenant' are the defaults
})

// The base: everything the parts below are typed against.
const accountsBaseDef = defineModuleBase({
  id: 'accounts',
  version: '0.1.0',
  config: shape({
    allowSelfRegistration: field.boolean().default(false),
  }),
  extensionPoints: {
    identityProviders: extensionPoint<IdentityProvider>({ mode: 'set' }),
  },
  entities: { profile },
})
export interface AccountsBase extends ModuleBaseType<typeof accountsBaseDef> {}
export const accountsBase: AccountsBase = accountsBaseDef

// A command on a chain-backed entity: a plain function of the input, the full current row and ctx.
// ctx.clock.now() is the invocation's time, a Temporal.Instant recorded as the events' recordedAt.
const deactivate = defineCommand(accountsBase, profile, {
  input: shape({ reason: field.string().optional() }),
  errors: [],
  execution: 'sync',
  decide: (input, current, ctx) => [ctx.events.deactivated({ at: ctx.clock.now(), reason: input.reason })],
})

// An entity query: read returns a request (a query description) that the kernel plans and runs.
// ctx.target is the entity as the caller may read it under this action's rules; email declares
// 'prefix', whose minimum is three characters, so the input requires three.
const search = defineQuery(accountsBase, profile, {
  input: shape({ text: field.string({ minLength: 3, maxLength: 80 }) }),
  output: pageOf(profile),
  page: { sortable: ['displayName', 'createdAt'], defaultSize: 25, maxSize: 100 },
  read: (input, ctx) =>
    ctx.target.query({
      where: { or: [{ displayName: { contains: input.text } }, { email: { startsWith: input.text } }] },
      sort: [{ field: 'displayName', direction: 'asc' }],
    }),
})

// A module-level command as a generator. ctx.load runs with accounts' own authority, so the uniqueness
// check sees every profile of the tenant even though the caller is anonymous (section 8.4). A concurrent
// registration fails the unique index at commit; the kernel repeats the unit and this check then throws.
const register = defineCommand(accountsBase, {
  input: shape({ displayName: field.string(), email: field.string({ format: 'email' }) }),
  output: shape({ profileId: field.ref.own('profile') }),
  errors: [emailTaken],
  execution: 'sync',
  auth: { public: true },
  *decide(input, ctx) {
    if (!ctx.config.allowSelfRegistration) throw errors.forbidden('Self-registration is disabled.')
    if (yield* ctx.load.accounts.profile.exists({ email: input.email })) throw emailTaken({ email: input.email })
    const id = yield* ctx.newId(profile) // recorded in the decision record, so a re-decide reproduces it
    return {
      events: [ctx.write.accounts.profile.create({ id, displayName: input.displayName, email: input.email })],
      result: { profileId: id },
    }
  },
})

// A query that reads the extension point; empty when no login module is selected. The providers'
// generators yield their own loads, answered with their contributor's authority.
const identities = defineQuery(accountsBase, {
  input: shape({ profileId: field.ref.own('profile') }),
  output: shape({ providers: field.list(field.json(shape({ id: field.string(), label: field.string() }))) }),
  principal: 'user',
  *read(input, ctx) {
    const providers = []
    for (const p of ctx.extensions.identityProviders) providers.push({ id: p.id, label: p.label, items: yield* p.listFor(input.profileId) })
    return { providers }
  },
})

// Rules, one per file in a project: policies/profile/operator.ts is the rule accounts.profile.operator.
const operator = defineRule(accountsBase, profile, { effect: 'allow', actions: ['*'], principal: 'operator' })
const directoryRole = defineRule(accountsBase, profile, {
  effect: 'allow',
  actions: ['read', 'search'],
  where: (ctx) => ctx.principal.roles.includes('directory'),
  fields: [], // reveals no maskable field: e-mail addresses stay hidden from the directory role
})
// A deny rule without `check` tests the row before the action: deactivated profiles are frozen,
// and an active profile can still be deactivated (section 8.2).
const frozen = defineRule(accountsBase, profile, {
  effect: 'deny',
  actions: ['deactivate', 'update'],
  where: () => ({ deactivatedAt: { isNull: false } }),
  reason: 'A deactivated profile is read-only.',
})
const registerOpen = defineRule(accountsBase, register, { effect: 'allow', public: true }) // policies/register/open.ts
const identitiesSignedIn = defineRule(accountsBase, identities, { effect: 'allow', principal: 'user' }) // policies/identities/signed-in.ts

// Bound to accounts (section 5.5): a pure service returning a request; callers write
// `yield* ctx.services.accounts.findByEmail(email)`.
const findByEmail = defineService(accountsBase, (own, email: string) => own.load.accounts.profile.one({ where: { email } }))

// The module literal: mounts the parts under keys that are ids. In a project the generator writes it as
// module.generated.ts from the directories; here it is written by hand under the same keys.
const accountsDef = defineModule(accountsBase, {
  entityActions: { profile: { deactivate, search } },
  actions: { register, identities },
  policies: { profile: { operator, directory: directoryRole, frozen }, register: { open: registerOpen }, identities: { signedIn: identitiesSignedIn } },
  services: { findByEmail },
})

export interface Accounts extends ModuleType<typeof accountsDef> {}
export const accounts: Accounts = accountsDef

// ============================================================================
// 2. auth: the higher module. It optionally uses accounts, contributes to it and adapts to it.
// ============================================================================

export const invalidCredentials = defineError('auth.invalid_credentials', {
  kind: 'unauthenticated',
  message: 'Unknown identifier or wrong password.',
})
export const reauthenticationRequired = defineError('auth.reauthentication_required', {
  kind: 'forbidden',
  message: 'Confirm your password or sign in again to change a credential.',
})

const credential = defineEntity({
  prefix: 'cred',
  dataSubject: 'subject',
  fields: {
    subject: field.subject().index(), // opaque subject id; a profile id when accounts is selected
    kind: field.enum(['password', 'passkey']),
    identifier: field.string({ format: 'email' }).optional().personal({ normalize: 'email' }), // login name; the unique index implies 'eq'
    verifier: field.verifier(), // Argon2id hash or passkey public key: hidden, sealed in events (section 6.6)
    label: field.string().optional().merge('lww'),
    lastUsedAt: field.instant().optional().maskable(),
    revokedAt: field.instant().optional(),
  },
  indexes: [{ fields: ['identifier'], unique: true, where: { kind: 'password', revokedAt: { isNull: true } } }],
  events: { revoked: shape({ at: field.instant(), reason: field.string().optional() }) },
  evolve: { revoked: (state, e) => ({ ...state, revokedAt: e.at }) },
  generated: { set: false }, // credentials change only through auth's own commands
})

const session = defineEntity({
  prefix: 'sess',
  dataSubject: 'subject',
  fields: {
    subject: field.subject().index(),
    credentialId: field.ref.own('credential'), // in-module reference: the base and the module do not exist yet
    publicId: field.string().unique(), // the lookup half of the token; the token itself is stored nowhere
    tokenVerifier: field.verifier(),
    authenticatedAt: field.instant(),
    idleExpiresAt: field.instant(),
    absoluteExpiresAt: field.instant(),
    revokedAt: field.instant().optional(),
  },
  history: 'state', // explicit opt-out: sessions are ephemeral
  reason: 'Sessions are replaced, not edited; the chain of credentials is the audit trail.',
  generated: { set: false },
})

// auth -> accounts: active only when accounts is selected. The declaration holds the data; the
// behaviour is mounted under the same key in the module literal below.
const toAccounts = defineContribution(accounts, {
  entities: {
    profile: {
      fields: {
        lastLoginAt: field.instant().optional().maskable(),
        emailVerifiedAt: field.instant().optional(),
      },
      relations: {
        credentials: relation.many.own('credential', { by: 'subject', to: 'id' }),
      },
    },
  },
})

// auth adapts itself when accounts is present; inside, accounts counts as required.
const whenAccounts = defineCondition([accounts], {
  entities: {
    credential: { fields: { profileId: field.ref(accounts, 'profile').optional() } },
  },
})
// A conditional part keyed on a contract: it exists only when a module providing `live` is selected.
const whenLive = defineCondition([contracts.live], {})

const authBaseDef = defineModuleBase({
  id: 'auth',
  version: '0.1.0',
  optional: [accounts, contracts.live],
  config: shape({
    sessionIdleMinutes: field.integer({ min: 5 }).default(720),
    sessionAbsoluteDays: field.integer({ min: 1 }).default(30),
    reauthenticateWithinMinutes: field.integer({ min: 1 }).default(10),
  }),
  entities: { credential, session },
  contributions: { toAccounts },
  conditions: { whenAccounts, whenLive },
})
export interface AuthBase extends ModuleBaseType<typeof authBaseDef> {}
export const authBase: AuthBase = authBaseDef

const revoke = defineCommand(authBase, credential, {
  input: shape({ reason: field.string().optional() }),
  decide: (input, current, ctx) => [ctx.events.revoked({ at: ctx.clock.now(), reason: input.reason })],
})

// Verification is computation, the session is state: login performs no effect.
const login = defineCommand(authBase, {
  input: shape({ identifier: field.string({ format: 'email' }), password: field.secret() }),
  output: shape({ sessionToken: field.string(), sessionId: field.ref.own('session'), expiresAt: field.instant() }),
  errors: [invalidCredentials],
  auth: { public: true },
  execution: 'sync',
  hints: {
    http: { cookie: { set: { name: '__Host-keelwerk_session', from: 'sessionToken', expiresFrom: 'expiresAt' }, omitFromBody: ['sessionToken'] } },
    cli: { login: { tokenField: 'sessionToken' } },
  },
  *decide(input, ctx) {
    // auth's own authority: reading credentials needs no rule and no escalation (section 8.4).
    const cred = yield* ctx.load.auth.credential.one({ where: { identifier: input.identifier, kind: 'password', revokedAt: { isNull: true } } })
    // Argon2id is pure but slow: the kernel answers it off the event loop. An unknown identifier is
    // verified against a dummy hash (section 17.2.2). Secret inputs are plain in process, redacted in logs.
    const ok = yield* ctx.compute.argon2idVerify(cred?.verifier ?? DUMMY_VERIFIER, input.password)
    if (!cred || !ok) throw invalidCredentials()
    const now = ctx.clock.now()
    const id = yield* ctx.newId(session)
    const token = yield* ctx.secrets.issue({ prefix: 'pss' }) // { plain, publicId, verifier }: recorded without the plaintext
    const idleExpiresAt = now.add({ minutes: ctx.config.sessionIdleMinutes }) // Temporal.Instant arithmetic, no helper
    return {
      events: [
        ctx.write.auth.session.create({
          id, subject: cred.subject, credentialId: cred.id, publicId: token.publicId, tokenVerifier: token.verifier,
          authenticatedAt: now, idleExpiresAt, absoluteExpiresAt: now.add({ hours: 24 * ctx.config.sessionAbsoluteDays }), // an Instant adds hours, not days
        }),
        ctx.write.auth.credential.update(cred, { lastUsedAt: now }), // the loaded row's version is the expected version
      ],
      result: { sessionToken: token.plain, sessionId: id, expiresAt: idleExpiresAt },
    }
  },
})

const logout = defineCommand(authBase, {
  principal: 'user',
  execution: 'sync',
  hints: { http: { cookie: { clear: { name: '__Host-keelwerk_session' } } } },
  decide: (_input, ctx) => {
    const sessionId = ctx.principal.ref?.credentialId
    return sessionId ? [ctx.write.auth.session.update(sessionId, { revokedAt: ctx.clock.now() })] : []
  },
})

// Invoked by auth's own reactions under auth.system; no user rule allows it. ctx.all answers both loads
// in one round trip where the adapter can.
const revokeSubject = defineCommand(authBase, {
  input: shape({ subject: field.subject(), reason: field.string() }),
  execution: 'sync',
  *decide(input, ctx) {
    const at = ctx.clock.now()
    const [credentials, sessions] = yield* ctx.all([
      ctx.load.auth.credential.many({ where: { subject: input.subject, revokedAt: { isNull: true } }, limit: 1000 }),
      ctx.load.auth.session.many({ where: { subject: input.subject, revokedAt: { isNull: true } }, limit: 1000 }),
    ])
    return [
      ...credentials.map((c) => ctx.write.auth.credential.revoked(c, { at, reason: input.reason })),
      ...sessions.map((s) => ctx.write.auth.session.update(s, { revokedAt: at })),
    ]
  },
})

// An optional module through the Maybe accessor (decision 32b): accounts may be absent, so its loads are
// reached through ifPresent, a request that answers undefined when accounts is not selected.
const whoami = defineQuery(authBase, {
  output: shape({ subject: field.subject(), displayName: field.string().optional() }),
  principal: 'user',
  *read(_input, ctx) {
    const profileId = profileIdOf(ctx.principal.subject)
    const row = profileId ? yield* ctx.load.accounts.ifPresent((a) => a.profile.byId(profileId)) : undefined // Profile | undefined
    return { subject: ctx.principal.subject, displayName: row?.displayName }
  },
})

// Rules, one per file: policies/login/open.ts is auth.login.open, policies/credential/self.ts is auth.credential.self.
const loginOpen = defineRule(authBase, login, { effect: 'allow', public: true })
const logoutSignedIn = defineRule(authBase, logout, { effect: 'allow', principal: 'user' })
const whoamiSignedIn = defineRule(authBase, whoami, { effect: 'allow', principal: 'user' })
const credentialSelf = defineRule(authBase, credential, {
  effect: 'allow',
  actions: ['read'],
  principal: 'user',
  where: (ctx) => ({ subject: ctx.principal.subject }),
  fields: ['lastUsedAt'],
  reason: 'A user sees their own credentials.',
})
const selfRevoke = defineRule(authBase, credential, { effect: 'allow', actions: ['revoke'], principal: 'user', where: (ctx) => ({ subject: ctx.principal.subject }) })
const alreadyRevoked = defineRule(authBase, credential, { effect: 'deny', actions: ['revoke'], where: () => ({ revokedAt: { isNull: false } }), reason: 'This credential is already revoked.' })
const selfSessions = defineRule(authBase, session, { effect: 'allow', actions: ['read'], principal: 'user', where: (ctx) => ({ subject: ctx.principal.subject }) })

// Services for dependants: pure, returning requests or generators that callers delegate to with yield*.
// The random salt is an answer recorded in the caller's decision record, so the hash is reproducible.
const verifyPassword = defineService(authBase, (own, verifier: string | undefined, password: string) => own.compute.argon2idVerify(verifier ?? DUMMY_VERIFIER, password))
const hashPassword = defineService(authBase, function* (own, password: string) {
  const salt = yield* own.random(16)
  return yield* own.compute.argon2idHash(password, salt)
})

// Parts of the contribution to accounts: typed with within(), so accounts counts as required and
// profile rows include the fields auth contributes. They run with auth's context.
const changePassword = defineCommand(within(authBase, toAccounts), 'profile', {
  input: shape({ currentPassword: field.secret().optional(), newPassword: field.secret() }),
  principal: 'user',
  errors: [reauthenticationRequired],
  execution: 'sync',
  *decide(input, _current, ctx) {
    const recent = yield* isRecentlyAuthenticated(ctx) // lib/: a generator that loads the caller's session
    const cred = yield* ctx.load.auth.credential.one({ where: { subject: ctx.principal.subject, kind: 'password', revokedAt: { isNull: true } } })
    const confirmed = input.currentPassword !== undefined && (yield* ctx.compute.argon2idVerify(cred?.verifier ?? DUMMY_VERIFIER, input.currentPassword))
    if (!recent && !confirmed) throw reauthenticationRequired()
    const salt = yield* ctx.random(16)
    const verifier = yield* ctx.compute.argon2idHash(input.newPassword, salt)
    return [
      ...(cred ? [ctx.write.auth.credential.update(cred, { verifier })] : []), // the old hash's key is destroyed at append
      ...(yield* revokeOtherSessions(ctx)), // lib/: loads the caller's other sessions and returns their drafts
    ]
  },
})

// "Own profile" only means something when a login exists; the rules live here, typed against profile, in
// contributions/to-accounts/policies/profile/: auth.accounts.profile.self, .self-edit, .self-password, .shared-credential.
const profileSelf = defineRule(within(authBase, toAccounts), 'profile', {
  effect: 'allow',
  actions: ['read'],
  principal: 'user',
  where: (ctx) => ({ id: ctx.principal.subjectAs('accounts.profile') }), // null never matches (section 8.3)
  fields: ['email', 'lastLoginAt'], // read rules list maskable fields only
})
const profileSelfEdit = defineRule(within(authBase, toAccounts), 'profile', {
  effect: 'allow',
  actions: ['update'],
  principal: 'user',
  where: (ctx) => ({ id: ctx.principal.subjectAs('accounts.profile') }),
  fields: ['displayName', 'locale'], // the fields a user may change
})
const profileSelfPassword = defineRule(within(authBase, toAccounts), 'profile', { effect: 'allow', actions: ['changePassword'], principal: 'user', where: (ctx) => ({ id: ctx.principal.subjectAs('accounts.profile') }) })
// A relation contributed above is usable in the same contribution.
const profileSharedCredential = defineRule(within(authBase, toAccounts), 'profile', {
  effect: 'allow',
  actions: ['read'],
  principal: 'user',
  where: (ctx) => ({ credentials: { some: { subject: ctx.principal.subject } } }),
})

// A factory of auth's own context: listFor is a generator that loads auth.credential with auth's authority.
const identityProvidersFill = defineFill(within(authBase, toAccounts), 'identityProviders', (own) => [passwordProvider(own)])

// accounts influences auth: when a profile is deactivated, every credential and session of that
// subject is revoked, in the same transaction, under auth.system (section 7.7). The reaction returns
// the invocation as an effect; the kernel runs it in this unit.
const revokeOnDeactivation = defineReaction(within(authBase, whenAccounts), {
  on: 'accounts.profile.deactivated',
  timing: 'inline',
  react: (event) => ({ effects: [invoke(revokeSubject, { subject: asSubject(event.state.id), reason: 'profile deactivated' })] }), // an own action, by value
})

// and the login timestamp flows back to the profile field auth contributed (a keyed job per event).
const recordLogin = defineReaction(within(authBase, whenAccounts), {
  on: 'auth.session.created',
  timing: 'async',
  react: (event, ctx) => {
    const profileId = event.current ? profileIdOf(event.current.subject) : null
    // auth may write lastLoginAt because it contributed that field to accounts.profile (section 8.4)
    return profileId ? [ctx.write.accounts.profile.update(profileId, { lastLoginAt: event.at })] : []
  },
})

// A subscription that exists only when a module providing the live contract is selected. The source
// is a description the live module runs; the item map is a pure function.
const sessionEvents = defineSubscription(within(authBase, whenLive), {
  event: shape({ sessionId: field.ref.own('session'), kind: field.enum(['created', 'revoked']) }),
  principal: 'user',
  source: (_input, ctx, resume) =>
    mapItems(
      ctx.live.entity('auth', 'session', { where: { subject: ctx.principal.subject }, after: resume }),
      (change) => (change.type === 'removed' ? undefined : { sessionId: change.id, kind: change.type === 'created' ? 'created' : 'revoked' }),
    ),
})
const sessionEventsSignedIn = defineRule(within(authBase, whenLive), sessionEvents, { effect: 'allow', principal: 'user' })

// A lifecycle hook is a reaction: pure, returning a decision. Logging is the one capability in ctx:
// write-only, never part of the decision.
const onTenantCreated = defineHook(authBase, 'onTenantCreated', (tenant, ctx) => {
  ctx.log.info({ tenant: tenant.id }, 'auth ready for tenant')
  return []
})

// Written by hand here; in a project the generator writes it from the directories, aliasing the clashing names.
const authDef = defineModule(authBase, {
  entityActions: { credential: { revoke } },
  actions: { login, logout, revokeSubject, whoami },
  policies: {
    login: { open: loginOpen },
    logout: { signedIn: logoutSignedIn },
    whoami: { signedIn: whoamiSignedIn },
    credential: { self: credentialSelf, selfRevoke, alreadyRevoked },
    session: { selfSessions },
  },
  services: { verifyPassword, hashPassword },
  // the behaviour of the contribution and the conditional parts declared in the base, under the same keys
  contributes: {
    toAccounts: {
      entityActions: { profile: { changePassword } },
      policies: { profile: { self: profileSelf, selfEdit: profileSelfEdit, selfPassword: profileSelfPassword, sharedCredential: profileSharedCredential } },
      extensionPoints: { identityProviders: identityProvidersFill },
    },
  },
  conditional: {
    whenAccounts: { reactions: { revokeOnDeactivation, recordLogin } },
    whenLive: { actions: { sessionEvents }, policies: { sessionEvents: { signedIn: sessionEventsSignedIn } } },
  },
  lifecycle: { onTenantCreated },
})

export interface Auth extends ModuleType<typeof authDef> {}
export const auth: Auth = authDef

// ============================================================================
// 2b. hooks: an external effect with its executor, a continuation and an inline test (decision 50a).
//     Outbound webhooks (decision 49a: they ship with Launchway's rebuild), reduced to one endpoint per backend. The module compiles
//     on its own (section 3.4); the apps below do not select it.
// ============================================================================

const delivery = defineEntity({
  prefix: 'hdl',
  fields: {
    event: field.string({ maxLength: 120 }),
    body: field.text(), // the JSON body as sent
    status: field.enum(['pending', 'delivered', 'failed']).default('pending'),
    responseStatus: field.integer().optional(),
  },
  events: {
    settled: shape({ status: field.enum(['delivered', 'failed']), responseStatus: field.integer().optional(), at: field.instant() }),
  },
  evolve: {
    settled: (state, e) => ({ ...state, status: e.status, responseStatus: e.responseStatus }),
  },
})

const hooksBaseDef = defineModuleBase({
  id: 'hooks',
  version: '0.1.0',
  config: shape({
    endpoint: field.string({ format: 'uri' }),
    signingKey: field.secret(), // sealed under the backend's key; only the executor reveals it
  }),
  entities: { delivery },
})
export interface HooksBase extends ModuleBaseType<typeof hooksBaseDef> {}
export const hooksBase: HooksBase = hooksBaseDef

// The effect: recorded as core.effect/<id> with `requested` (in the requesting unit) and `settled`.
// Its input says everything the effect does; the secret travels as a reference, never as plaintext.
const post = defineEffect(hooksBase, {
  input: shape({ url: field.string({ format: 'uri' }), signingKey: field.secret(), body: field.text() }),
  output: shape({ status: field.integer() }),
})

// The module's only imperative code: no data access, egress only, the effect id as idempotency key.
// One POST is all or nothing, so its retries are mechanical and belong to the executor.
const postExecutor = defineEffectExecutor(hooksBase, post, {
  queue: 'hooks',
  inline: true, // needs no capability, so prepare may also perform it
  timeout: '10s',
  group: ({ input }) => ({ id: `host:${new URL(input.url).host}`, concurrency: 2 }),
  retry: { delays: 'exponential', maxDelay: '30m', giveUpAfter: 'PT24H' },
  run: async (input, ctx) => {
    const key = await ctx.secrets.reveal(input.signingKey, 'sign an outbound webhook')
    const response = await ctx.egress.fetch(input.url, {
      method: 'POST',
      body: input.body,
      headers: { 'content-type': 'application/json', 'idempotency-key': ctx.effect.id, 'x-signature-256': signHmacSha256(key, input.body) },
      signal: ctx.signal,
    })
    if (response.status === 429 || response.status >= 500) throw errors.unavailable(`The endpoint answered ${response.status}.`) // retried
    return { status: response.status } // a 4xx is an outcome, not an error
  },
})

// A command that requests the effect with a continuation; the response also lists the effect's id,
// so a client can watch core.effect.watch until it settles.
const notify = defineCommand(hooksBase, {
  input: shape({ event: field.string({ maxLength: 120 }), payload: field.text() }),
  output: shape({ deliveryId: field.ref.own('delivery') }),
  execution: 'sync',
  *decide(input, ctx) {
    const id = yield* ctx.newId(delivery)
    const body = JSON.stringify({ id, event: input.event, payload: input.payload })
    return {
      events: [ctx.write.hooks.delivery.create({ id, event: input.event, body })],
      effects: [post({ url: ctx.config.endpoint, signingKey: ctx.config.signingKey, body }, { then: recordOutcome, with: { id } })],
      result: { deliveryId: id },
    }
  },
})

// The continuation: an entity command the kernel invokes under hooks.system with the effect's outcome.
const recordOutcome = defineCommand(hooksBase, delivery, {
  input: outcomeOf(post),
  decide: (input, _current, ctx) => {
    const status = input.outcome.ok ? input.outcome.value.status : undefined
    return [ctx.events.settled({ status: status !== undefined && status < 300 ? 'delivered' : 'failed', responseStatus: status, at: ctx.clock.now() })]
  },
})

// An inline effect in prepare: the operator waits for the answer, which nothing retries; the effect is
// still recorded. decide sees prepare's result as ctx.prepared.
const testEndpoint = defineCommand(hooksBase, {
  output: shape({ status: field.integer().optional(), error: field.string().optional() }),
  principal: 'operator',
  execution: 'sync',
  *prepare(_input, ctx) {
    return yield* ctx.perform(post({ url: ctx.config.endpoint, signingKey: ctx.config.signingKey, body: '{"event":"hooks.test"}' }))
  },
  decide: (_input, ctx) => ({ result: ctx.prepared.ok ? { status: ctx.prepared.value.status } : { error: ctx.prepared.error.code } }),
})

const notifyOperator = defineRule(hooksBase, notify, { effect: 'allow', principal: 'operator' }) // policies/notify/operator.ts
const testEndpointOperator = defineRule(hooksBase, testEndpoint, { effect: 'allow', principal: 'operator' })

const hooksDef = defineModule(hooksBase, {
  actions: { notify, testEndpoint },
  entityActions: { delivery: { recordOutcome } }, // hooks.system may invoke its own actions (section 7.7)
  policies: { notify: { operator: notifyOperator }, testEndpoint: { operator: testEndpointOperator } },
  effects: { post },
  executors: { post: postExecutor },
})
export interface Hooks extends ModuleType<typeof hooksDef> {}
export const hooks: Hooks = hooksDef

// ============================================================================
// 3. Two apps from the same modules. Apps list modules only; infrastructure is the deployment's.
//    In a project, each app's selection is the as-const tuple of its src/modules.ts (section 23.1).
// ============================================================================

const directoryModules = [accounts, rest] as const // no auth: profiles without logins
const directoryDef = defineApp({
  id: 'directory',
  modules: directoryModules,
})
export interface Directory extends AppType<typeof directoryDef> {}
export const directory: Directory = directoryDef

const portalModules = [accounts, auth, live, rest, graphql] as const
// An app action, typed against the app's selection.
const health = defineQuery(portalModules, { auth: { public: true }, scope: 'backend', output: shape({ ok: field.boolean() }), read: () => ({ ok: true }) })

const portalDef = defineApp({
  id: 'portal',
  modules: portalModules,
  actions: { health },
  execution: {
    'accounts.profile.deactivate': 'either', // external callers may prefer async; invoke keeps the declared mode
  },
  authorization: { mode: 'strict', decisionLog: 'denials' },
  policies: {
    disable: [], // rule ids such as 'accounts.profile.directory'
    add: [],
  },
})
export interface Portal extends AppType<typeof portalDef> {}
export const portal: Portal = portalDef

// Derived types are exact per app and need no generator.
export type PortalProfile = Row<Portal, 'accounts.profile'>
//   { id: Id<'accounts.profile'>; displayName: string; email: string; locale: string; deactivatedAt?: Temporal.Instant | undefined;
//     lastLoginAt?: Temporal.Instant | undefined; emailVerifiedAt?: Temporal.Instant | undefined;   <- contributed by auth
//     createdAt: Temporal.Instant; updatedAt: Temporal.Instant; archivedAt?: Temporal.Instant | undefined; version: number }
export type DirectoryProfile = Row<Directory, 'accounts.profile'>
//   the same without lastLoginAt and emailVerifiedAt; `credentials` and `changePassword` do not exist.
export type PortalCredential = Row<Portal, 'auth.credential'>
//   has `profileId?: Id<'accounts.profile'> | undefined` because accounts is selected; no verifier (hidden).
// Clients and transports read rows as Readable<Row>: only the maskable fields (email, lastLoginAt) are optional.

// ============================================================================
// 4. One deployment hosts both apps; backends and tenants are created at runtime.
// ============================================================================

export default defineDeployment({
  apps: [directory, portal],
  infrastructure: [
    postgresAdapter(),
    httpHost({ listen: [{ port: 3000 }] }), // provides contracts.httpHost; serves the invocation protocol for every app
    ledgerFile({ path: '/var/lib/keelwerk-ledger/erasure.log' }), // erasures and chain anchors (decision 35b)
  ],
  control: { adapter: 'postgres', url: env('KEELWERK_CONTROL_URL') }, // env() and secret() read the environment here only
  placements: {
    default: { adapter: 'postgres', url: env('KEELWERK_DATA_URL'), strategy: 'shared-tables' },
    isolated: { adapter: 'postgres', url: env('KEELWERK_ISOLATED_URL'), strategy: 'schema-per-tenant' },
  },
  tenantResolution: [byHostname(), byScopeKey(), byHeader('x-keelwerk-tenant')],
  operator: { socket: '/run/keelwerk/operator.sock', bootstrapSecret: secret('KEELWERK_OPERATOR_SECRET') },
  keys: { masterKey: secret('KEELWERK_MASTER_KEY') },
  telemetry: { otlp: env('OTEL_EXPORTER_OTLP_ENDPOINT') },
})

// ============================================================================
// 5. Calling actions: the CLI, tests and modules all go through the invoker. Callers outside
//    keelwerk are imperative code; they await outcomes, handlers never do.
// ============================================================================

export async function example(operator: AppClient<Portal>, client: AppClient<Portal>) {
  // Operator work at deployment scope, over the operator socket: a backend running `portal`, then a tenant.
  const backend = await operator.invoke('core.backend.create', { name: 'acme', app: 'portal', placement: 'default' })
  const tenant = await operator.invoke('core.tenant.create', { backendId: backend.id, name: 'Acme NV', domains: ['acme.example'] })

  // Tenant-scoped calls: the scope comes from the client's profile (backend, tenant) and the token, once logged in.
  const anonymous = client.as({ backend: backend.id, tenant: tenant.id })
  const { profileId } = await anonymous.invoke('accounts.register', { displayName: 'Jens', email: 'jens@acme.example' })
  const { sessionToken } = await anonymous.invoke('auth.login', { identifier: 'Jens@Acme.example', password: '<password>' }) // normalised: matches
  const scoped = client.as({ backend: backend.id, tenant: tenant.id, token: sessionToken })

  const page = await scoped.invoke('accounts.profile.search', { text: 'Jen', first: 10 }) // three characters: the prefix minimum
  const receipt = await scoped.invoke('accounts.profile.deactivate', { id: profileId }, { prefer: 'async' })
  //    ^ { commandId, status: 'accepted' } because the app declared `either` for external callers
  void receipt

  for await (const frame of scoped.subscribe('auth.sessionEvents', {})) {
    if ('control' in frame) {
      if (frame.control === 'reset') break // catch up with `changes` from frame.state, then subscribe again
      continue // 'head' or 'gap'
    }
    void frame.event // { sessionId, kind }, resumable with frame.state
  }
  return page.items.map((p) => p.displayName)
}

// Helpers assumed from a module or from the application; shown so the sketch reads top to bottom.
// Pure helpers live in a module's lib/; signHmacSha256 is an executor helper (src/executors/lib/),
// the only place a module may use node:crypto.
declare const DUMMY_VERIFIER: string
declare function passwordProvider(own: unknown): IdentityProvider
declare function isRecentlyAuthenticated(ctx: unknown): Gen<boolean>
declare function revokeOtherSessions(ctx: unknown): Gen<readonly Draft[]>
declare function asSubject(profileId: Id<'accounts.profile'>): string
declare function profileIdOf(subject: string): Id<'accounts.profile'> | null
declare function signHmacSha256(key: string, body: string): string
