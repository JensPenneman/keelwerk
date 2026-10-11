/**
 * pennestack public API sketch, as seen by an application author.
 * Date: 2026-10-11 (first version 2026-10-08). Status: target for the spike of roadmap M0, which
 * type-checks it as the acceptance test of the DSL; it does not compile against anything yet.
 *
 * It shows: an accounts module, an authentication module that contributes to accounts and adapts
 * itself when accounts (or a live module) is present, two apps composing them, a deployment, rules
 * with conditions on the row acted on and the row produced, commands, queries and a subscription,
 * and how the derived types are consumed. The DSL is specified in architecture.md section 4, the
 * type-level model in section 4.7, the handler context in section 7.6, authorization in section 8
 * and the authentication module in section 17.2.
 */

import {
  contracts,
  defineApp,
  defineDeployment,
  defineEntity,
  defineError,
  defineModule,
  env,
  errors,
  extensionPoint,
  field,
  mapItems,
  relation,
  secret,
  shape,
  byHeader,
  byHostname,
  byScopeKey,
  type AppType,
  type Id,
  type ModuleType,
  type Row,
} from '@pennestack/core'
import { ledgerFile } from '@pennestack/core/ledger'
import { postgresAdapter } from '@pennestack/adapter-postgres'
import { httpHost } from '@pennestack/transport-http'
import { rest } from '@pennestack/transport-rest'
import { graphql } from '@pennestack/transport-graphql'
import { live } from '@pennestack/live'
import type { AppClient } from '@pennestack/client'

// ============================================================================
// 1. accounts: the lower module of the pair. It knows nothing about auth.
// ============================================================================

/** Contract of the extension point accounts declares so that login modules can describe identities. */
export interface IdentityProvider {
  readonly id: string
  readonly label: string
  /** Fillers are bound to their contributor's context (section 5.5): auth reads its own credentials here. */
  listFor(profileId: Id<'accounts.profile'>): Promise<ReadonlyArray<{ kind: string; label: string; createdAt: Date }>>
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
    email: field.string({ format: 'email' }).unique().personal().maskable(), // unique implies merge 'exclusive'
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

const accountsDef = defineModule({
  id: 'accounts',
  version: '0.1.0',
  config: shape({
    allowSelfRegistration: field.boolean().default(false),
  }),
  extensionPoints: {
    identityProviders: extensionPoint<IdentityProvider>({ mode: 'set' }),
  },
})
  .entities({ profile })
  .entityActions('profile', (e) => ({
    // A command on a chain-backed entity: a pure decider over the full current row.
    deactivate: e.command({
      input: shape({ reason: field.string().optional() }),
      errors: [],
      execution: 'sync',
      decide: (input, current, ctx) => [e.events.deactivated({ at: ctx.clock.now(), reason: input.reason })],
    }),
    // An entity query: ctx.target is the entity as the caller may read it under this action's rules.
    search: e.query({
      input: shape({ text: field.string({ maxLength: 80 }) }),
      output: e.page(),
      page: { sortable: ['displayName', 'createdAt'], defaultSize: 25, maxSize: 100 },
      handle: (input, ctx) =>
        ctx.target.query({
          where: { or: [{ displayName: { contains: input.text } }, { email: { startsWith: input.text } }] },
          sort: [{ field: 'displayName', direction: 'asc' }],
        }),
    }),
  }))
  .actions((b) => ({
    // A module-level command. ctx.data runs with accounts' own authority, so the uniqueness check
    // sees every profile of the tenant even though the caller is anonymous (section 8.4).
    register: b.command({
      input: shape({ displayName: field.string(), email: field.string({ format: 'email' }) }),
      output: shape({ profileId: field.ref.own('profile') }),
      errors: [emailTaken],
      execution: 'sync',
      auth: { public: true },
      handle: async (input, ctx) => {
        if (!ctx.config.allowSelfRegistration) throw errors.forbidden('Self-registration is disabled.')
        const existing = await ctx.data.accounts.profile.findOne({ where: { email: input.email } })
        if (existing) throw emailTaken({ email: input.email })
        const created = await ctx.data.accounts.profile.create({ displayName: input.displayName, email: input.email })
        return { profileId: created.id }
      },
    }),
    // A query that reads the extension point; empty when no login module is selected.
    identities: b.query({
      input: shape({ profileId: field.ref.own('profile') }),
      output: shape({ providers: field.list(field.json(shape({ id: field.string(), label: field.string() }))) }),
      principal: 'user',
      handle: async (input, ctx) => ({
        providers: await Promise.all(
          ctx.extensions.identityProviders.map(async (p) => ({ id: p.id, label: p.label, items: await p.listFor(input.profileId) })),
        ),
      }),
    }),
  }))
  .policies((rule) => [
    rule.allow('profile', '*', { id: 'operator', principal: 'operator' }),
    rule.allow('profile', ['read', 'search'], {
      id: 'directory',
      where: (ctx) => ctx.principal.roles.includes('directory'),
      fields: [], // reveals no maskable field: e-mail addresses stay hidden from the directory role
    }),
    // A deny rule without `check` tests the row before the action: deactivated profiles are frozen,
    // and an active profile can still be deactivated (section 8.2).
    rule.deny('profile', ['deactivate', 'update'], {
      id: 'frozen',
      where: () => ({ deactivatedAt: { isNull: false } }),
      reason: 'A deactivated profile is read-only.',
    }),
    rule.allow('register', { public: true }),
    rule.allow('identities', { principal: 'user' }),
  ])
  .services((s) => ({
    // Bound to accounts (section 5.5): callers write ctx.services.accounts.findByEmail(email).
    findByEmail: s.service(async (own, email: string) => own.data.accounts.profile.findOne({ where: { email } })),
  }))

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
    identifier: field.string({ format: 'email' }).optional().personal(), // login name of password credentials
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
    credentialId: field.ref.own('credential'), // in-module reference: the module value does not exist yet
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

const authDef = defineModule({
  id: 'auth',
  version: '0.1.0',
  optional: [accounts, contracts.live],
  config: shape({
    sessionIdleMinutes: field.integer({ min: 5 }).default(720),
    sessionAbsoluteDays: field.integer({ min: 1 }).default(30),
    reauthenticateWithinMinutes: field.integer({ min: 1 }).default(10),
  }),
})
  .entities({ credential, session })
  .entityActions('credential', (e) => ({
    revoke: e.command({
      input: shape({ reason: field.string().optional() }),
      decide: (input, current, ctx) => [e.events.revoked({ at: ctx.clock.now(), reason: input.reason })],
    }),
  }))
  .actions((b) => ({
    login: b.command({
      input: shape({ identifier: field.string({ format: 'email' }), password: field.secret() }),
      output: shape({ sessionToken: field.string(), sessionId: field.ref.own('session'), expiresAt: field.instant() }),
      errors: [invalidCredentials],
      auth: { public: true },
      execution: 'sync',
      hints: {
        http: { cookie: { set: { name: '__Host-pennestack_session', from: 'sessionToken', expiresFrom: 'expiresAt' }, omitFromBody: ['sessionToken'] } },
        cli: { login: { tokenField: 'sessionToken' } },
      },
      handle: async (input, ctx) => {
        // auth's own authority: reading credentials needs no rule and no escalation (section 8.4).
        const cred = await ctx.data.auth.credential.findOne({ where: { identifier: input.identifier, kind: 'password', revokedAt: { isNull: true } } })
        const ok = await ctx.services.auth.verifyPassword(cred?.verifier, input.password) // secret inputs are plain in process, redacted in logs
        if (!cred || !ok) throw invalidCredentials()
        const now = ctx.clock.now()
        const token = ctx.secrets.issue({ prefix: 'pss' }) // { plain, publicId, verifier }: shown once
        const idleExpiresAt = new Date(now.getTime() + ctx.config.sessionIdleMinutes * 60_000)
        const absoluteExpiresAt = new Date(now.getTime() + ctx.config.sessionAbsoluteDays * 86_400_000)
        const s = await ctx.data.auth.session.create({
          subject: cred.subject, credentialId: cred.id, publicId: token.publicId, tokenVerifier: token.verifier,
          authenticatedAt: now, idleExpiresAt, absoluteExpiresAt,
        })
        await ctx.data.auth.credential.update({ where: { id: cred.id }, patch: { lastUsedAt: now } })
        return { sessionToken: token.plain, sessionId: s.id, expiresAt: idleExpiresAt }
      },
    }),
    logout: b.command({
      principal: 'user',
      execution: 'sync',
      hints: { http: { cookie: { clear: { name: '__Host-pennestack_session' } } } },
      handle: async (_input, ctx) => {
        const sessionId = ctx.principal.ref?.credentialId
        if (sessionId) await ctx.data.auth.session.update({ where: { id: sessionId }, patch: { revokedAt: ctx.clock.now() } })
      },
    }),
    // Invoked by auth's own reactions under auth.system; no user rule allows it.
    revokeSubject: b.command({
      input: shape({ subject: field.subject(), reason: field.string() }),
      execution: 'sync',
      handle: async (input, ctx) => {
        const now = ctx.clock.now()
        await ctx.data.auth.credential.update({ where: { subject: input.subject, revokedAt: { isNull: true } }, patch: { revokedAt: now } })
        await ctx.data.auth.session.update({ where: { subject: input.subject, revokedAt: { isNull: true } }, patch: { revokedAt: now } })
      },
    }),
  }))
  .policies((rule) => [
    rule.allow('login', { public: true }),
    rule.allow('logout', { principal: 'user' }),
    rule.allow('credential', ['read'], {
      id: 'self',
      principal: 'user',
      where: (ctx) => ({ subject: ctx.principal.subject }),
      fields: ['lastUsedAt'],
      reason: 'A user sees their own credentials.',
    }),
    rule.allow('credential', ['revoke'], { id: 'self-revoke', principal: 'user', where: (ctx) => ({ subject: ctx.principal.subject }) }),
    rule.deny('credential', ['revoke'], { id: 'already-revoked', where: () => ({ revokedAt: { isNull: false } }), reason: 'This credential is already revoked.' }),
    rule.allow('session', ['read'], { id: 'self-sessions', principal: 'user', where: (ctx) => ({ subject: ctx.principal.subject }) }),
  ])
  .services((s) => ({
    // Argon2id through node:crypto; an unknown identifier is verified against a dummy hash (section 17.2.2).
    verifyPassword: s.service(async (_own, verifier: string | undefined, password: string) => argon2idVerify(verifier ?? DUMMY_VERIFIER, password)),
    hashPassword: s.service(async (_own, password: string) => argon2idHash(password)),
  }))
  // auth -> accounts: active only when accounts is selected.
  .contributes((c) => [
    c.to(accounts, {
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
      entityActions: {
        profile: (e) => ({
          // Runs with auth's context: it writes auth.credential with auth's authority.
          changePassword: e.command({
            input: shape({ currentPassword: field.secret().optional(), newPassword: field.secret() }),
            principal: 'user',
            errors: [reauthenticationRequired],
            execution: 'sync',
            handle: async (input, ctx) => {
              const recent = await isRecentlyAuthenticated(ctx)
              const cred = await ctx.data.auth.credential.findOne({ where: { subject: ctx.principal.subject, kind: 'password', revokedAt: { isNull: true } } })
              const confirmed = input.currentPassword !== undefined && (await ctx.services.auth.verifyPassword(cred?.verifier, input.currentPassword))
              if (!recent && !confirmed) throw reauthenticationRequired()
              const verifier = await ctx.services.auth.hashPassword(input.newPassword)
              if (cred) await ctx.data.auth.credential.update({ where: { id: cred.id }, patch: { verifier } }) // the old hash's key is destroyed
              await revokeOtherSessions(ctx)
            },
          }),
        }),
      },
      policies: (rule) => [
        // "Own profile" only means something when a login exists; the fragment lives here, typed against profile.
        rule.allow('profile', ['read'], {
          id: 'self',
          principal: 'user',
          where: (ctx) => ({ id: ctx.principal.subjectAs('accounts.profile') }), // null never matches (section 8.3)
          fields: ['email', 'lastLoginAt'], // read rules list maskable fields only
        }),
        rule.allow('profile', ['update'], {
          id: 'self-edit',
          principal: 'user',
          where: (ctx) => ({ id: ctx.principal.subjectAs('accounts.profile') }),
          fields: ['displayName', 'locale'], // the fields a user may change
        }),
        rule.allow('profile', ['changePassword'], { id: 'self-password', principal: 'user', where: (ctx) => ({ id: ctx.principal.subjectAs('accounts.profile') }) }),
        // A relation contributed above is usable in the same contribution.
        rule.allow('profile', ['read'], {
          id: 'shared-credential',
          principal: 'user',
          where: (ctx) => ({ credentials: { some: { subject: ctx.principal.subject } } }),
        }),
      ],
      extensionPoints: {
        // A factory of auth's own context: listFor reads auth.credential with auth's authority.
        identityProviders: (own) => [passwordProvider(own)],
      },
    }),
  ])
  // auth adapts itself when accounts is present; inside, accounts counts as required.
  .conditional((w) => [
    w.when([accounts], {
      entities: {
        credential: { fields: { profileId: field.ref(accounts, 'profile').optional() } },
      },
      reactions: (r) => [
        // accounts influences auth: when a profile is deactivated, every credential and session of that
        // subject is revoked, in the same transaction, under auth.system (section 7.7).
        r.inline(accounts, 'profile.deactivated', async (event, ctx) => {
          await ctx.invoke('auth.revokeSubject', { subject: asSubject(event.state.id), reason: 'profile deactivated' })
        }),
        // and the login timestamp flows back to the profile field auth contributed (a keyed job per event).
        r.own('session.created', { timing: 'async' }, async (event, ctx) => {
          const profileId = event.current ? profileIdOf(event.current.subject) : null
          // auth may write lastLoginAt because it contributed that field to accounts.profile (section 8.4)
          if (profileId) await ctx.data.accounts.profile.update({ where: { id: profileId }, patch: { lastLoginAt: event.at } })
        }),
      ],
    }),
    // A subscription that exists only when a module providing the live contract is selected.
    w.when([contracts.live], {
      actions: (b) => ({
        sessionEvents: b.subscription({
          event: shape({ sessionId: field.ref.own('session'), kind: field.enum(['created', 'revoked']) }),
          principal: 'user',
          source: (_input, ctx, resume) =>
            mapItems(
              ctx.live.entity('auth', 'session', { where: { subject: ctx.principal.subject }, after: resume }),
              (change) => (change.type === 'removed' ? undefined : { sessionId: change.id, kind: change.type === 'created' ? 'created' : 'revoked' }),
            ),
        }),
      }),
      policies: (rule) => [rule.allow('sessionEvents', { principal: 'user' })],
    }),
  ])
  .lifecycle({
    onTenantCreated: async (tenant, ctx) => {
      ctx.log.info({ tenant: tenant.id }, 'auth ready for tenant')
    },
  })

export interface Auth extends ModuleType<typeof authDef> {}
export const auth: Auth = authDef

// ============================================================================
// 3. Two apps from the same modules. Apps list modules only; infrastructure is the deployment's.
// ============================================================================

const directoryDef = defineApp({
  id: 'directory',
  modules: [accounts, rest], // no auth: profiles without logins
})
export interface Directory extends AppType<typeof directoryDef> {}
export const directory: Directory = directoryDef

const portalDef = defineApp({
  id: 'portal',
  modules: [accounts, auth, live, rest, graphql],
  actions: (b) => ({
    health: b.query({ auth: { public: true }, scope: 'backend', output: shape({ ok: field.boolean() }), handle: async () => ({ ok: true }) }),
  }),
  execution: {
    'accounts.profile.deactivate': 'either', // external callers may prefer async; ctx.invoke keeps the declared mode
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
//   { id: Id<'accounts.profile'>; displayName: string; email: string; locale: string; deactivatedAt?: Date | undefined;
//     lastLoginAt?: Date | undefined; emailVerifiedAt?: Date | undefined;   <- contributed by auth
//     createdAt: Date; updatedAt: Date; archivedAt?: Date | undefined; version: number }
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
    ledgerFile({ path: '/var/lib/pennestack-ledger/erasure.log' }),
  ],
  control: { adapter: 'postgres', url: env('PENNESTACK_CONTROL_URL') },
  placements: {
    default: { adapter: 'postgres', url: env('PENNESTACK_DATA_URL'), strategy: 'shared-tables' },
    isolated: { adapter: 'postgres', url: env('PENNESTACK_ISOLATED_URL'), strategy: 'schema-per-tenant' },
  },
  tenantResolution: [byHostname(), byScopeKey(), byHeader('x-pennestack-tenant')],
  operator: { socket: '/run/pennestack/operator.sock', bootstrapSecret: secret('PENNESTACK_OPERATOR_SECRET') },
  keys: { masterKey: secret('PENNESTACK_MASTER_KEY') },
  telemetry: { otlp: env('OTEL_EXPORTER_OTLP_ENDPOINT') },
})

// ============================================================================
// 5. Calling actions: the CLI, tests and modules all go through the invoker.
// ============================================================================

export async function example(operator: AppClient<Portal>, client: AppClient<Portal>) {
  // Operator work at deployment scope, over the operator socket: a backend running `portal`, then a tenant.
  const backend = await operator.invoke('core.backend.create', { name: 'acme', app: 'portal', placement: 'default' })
  const tenant = await operator.invoke('core.tenant.create', { backendId: backend.id, name: 'Acme NV', domains: ['acme.example'] })

  // Tenant-scoped calls: the scope comes from the client's profile (backend, tenant) and the token, once logged in.
  const anonymous = client.as({ backend: backend.id, tenant: tenant.id })
  const { profileId } = await anonymous.invoke('accounts.register', { displayName: 'Jens', email: 'jens@acme.example' })
  const { sessionToken } = await anonymous.invoke('auth.login', { identifier: 'jens@acme.example', password: '<password>' })
  const scoped = client.as({ backend: backend.id, tenant: tenant.id, token: sessionToken })

  const page = await scoped.invoke('accounts.profile.search', { text: 'Je', first: 10 })
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
declare const DUMMY_VERIFIER: string
declare function argon2idVerify(verifier: string, password: string): Promise<boolean>
declare function argon2idHash(password: string): Promise<string>
declare function passwordProvider(own: unknown): IdentityProvider
declare function isRecentlyAuthenticated(ctx: unknown): Promise<boolean>
declare function revokeOtherSessions(ctx: unknown): Promise<void>
declare function asSubject(profileId: Id<'accounts.profile'>): string
declare function profileIdOf(subject: string): Id<'accounts.profile'> | null
