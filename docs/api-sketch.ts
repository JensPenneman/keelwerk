/**
 * pennestack public API sketch, as seen by an application author.
 * Date: 2026-10-08. Status: target for the spike; it does not compile against anything yet.
 *
 * It shows: an accounts module, an authentication module that contributes to accounts and adapts
 * itself when accounts is present, a small app composing them with two transports and a data
 * adapter, a deployment, policies, commands and queries, and how the derived types are consumed.
 * The DSL is specified in architecture.md section 4; the type-level model in section 4.7.
 */

import {
  defineApp,
  defineDeployment,
  defineEntity,
  defineError,
  defineModule,
  env,
  errors,
  extensionPoint,
  field,
  relation,
  shape,
  type AppEntities,
  type AppClient,
  type Doc,
} from '@pennestack/core'
import { postgres } from '@pennestack/adapter-postgres'
import { rest } from '@pennestack/transport-rest'
import { graphql } from '@pennestack/transport-graphql'
import { cli } from '@pennestack/transport-cli'

// ============================================================================
// 1. accounts: the lower module of the pair. It knows nothing about auth.
// ============================================================================

/** Contract of the extension point accounts declares so that login modules can describe identities. */
export interface IdentityProvider {
  readonly id: string
  readonly label: string
  listFor(profileId: string): Promise<ReadonlyArray<{ kind: string; label: string; createdAt: Date }>>
}

export const emailTaken = defineError('accounts.email_taken', {
  kind: 'conflict',
  message: 'This e-mail address is already in use.',
  data: shape({ email: field.string() }),
})

const profile = defineEntity({
  prefix: 'prof',
  fields: {
    displayName: field.string({ maxLength: 120 }).merge('lww'),
    email: field.string({ format: 'email' }).unique().personal(), // unique implies merge 'exclusive'
    locale: field.string().optional().default('nl-BE'),
    bio: field.richText().optional(), // merge 'richText', collaborative
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

export const accounts = defineModule({
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
    // A command on a chain-backed entity: pure decider, events out.
    deactivate: e.command({
      input: shape({ reason: field.string().optional() }),
      errors: [],
      execution: 'sync',
      decide: (input, current, ctx) => {
        if (current.deactivatedAt) return [] // idempotent by construction
        return [e.events.deactivated({ at: ctx.clock.now(), reason: input.reason })]
      },
    }),
    // A query returning a page; the principal's plan is applied by ctx.data.
    search: e.query({
      input: shape({ text: field.string({ maxLength: 80 }) }),
      output: e.page(),
      page: { sortable: ['displayName', 'createdAt'], defaultSize: 25, maxSize: 100 },
      handle: (input, ctx) =>
        ctx.data.accounts.profile.query({
          where: { or: [{ displayName: { contains: input.text } }, { email: { startsWith: input.text } }] },
          sort: [{ field: 'displayName', direction: 'asc' }],
        }),
    }),
  }))
  .actions((b) => ({
    // A module-level command with an imperative handler; uniqueness keeps it synchronous.
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
      handle: async (input, ctx) => ({
        providers: await Promise.all(
          ctx.extensions.identityProviders.map(async (p) => ({ id: p.id, label: p.label, items: await p.listFor(input.profileId) })),
        ),
      }),
    }),
  }))
  .policies((rule) => [
    // Operators and services with the 'directory' role may read everything (roles come from enrichers).
    rule.allow('profile', '*', { id: 'operator', when: (ctx) => ctx.principal.kind === 'operator' }),
    rule.allow('profile', ['get', 'query', 'search'], {
      id: 'directory',
      when: (ctx) => ctx.principal.roles.includes('directory'),
      fields: ['id', 'displayName', 'locale', 'createdAt'],
    }),
    rule.deny('profile', ['deactivate', 'set'], {
      id: 'frozen',
      where: () => ({ deactivatedAt: { ne: null } }),
      reason: 'A deactivated profile is read-only.',
    }),
    rule.allow('register', { public: true }),
    rule.allow('identities', { when: (ctx) => ctx.principal.kind !== 'anonymous' }),
  ])
  .services((s) => ({
    findByEmail: s.service(async (ctx, email: string) => ctx.data.accounts.profile.findOne({ where: { email } })),
  }))

// ============================================================================
// 2. auth: the higher module. It optionally uses accounts, contributes to it and adapts to it.
// ============================================================================

export const invalidCredentials = defineError('auth.invalid_credentials', {
  kind: 'unauthenticated',
  message: 'Unknown subject or wrong secret.',
})
export const alreadyRevoked = defineError('auth.credential_revoked', { kind: 'conflict', message: 'This credential is already revoked.' })

const credential = defineEntity({
  prefix: 'cred',
  fields: {
    subject: field.string().index(), // opaque subject id; becomes the profile id when accounts is on
    kind: field.enum(['password', 'passkey']),
    secretHash: field.string().hidden(),
    email: field.string({ format: 'email' }).unique().personal(),
    label: field.string().optional().merge('lww'),
    revokedAt: field.instant().optional(),
  },
  events: { revoked: shape({ at: field.instant(), reason: field.string().optional() }) },
  evolve: { revoked: (state, e) => ({ ...state, revokedAt: e.at }) },
})

const session = defineEntity({
  prefix: 'sess',
  fields: {
    subject: field.string().index(),
    credentialId: field.ref.own('credential'), // in-module reference: the module value does not exist yet
    expiresAt: field.instant(),
    revokedAt: field.instant().optional(),
  },
  history: 'state', // explicit opt-out: sessions are ephemeral
  reason: 'Sessions are replaced, not edited; the chain of credentials is the audit trail.',
})

export const auth = defineModule({
  id: 'auth',
  version: '0.1.0',
  optional: [accounts],
  config: shape({ sessionTtlSeconds: field.integer({ min: 60 }).default(86_400) }),
})
  .entities({ credential, session })
  .entityActions('credential', (e) => ({
    revoke: e.command({
      input: shape({ reason: field.string().optional() }),
      errors: [alreadyRevoked],
      decide: (input, current, ctx) => {
        if (current.revokedAt) throw alreadyRevoked()
        return [e.events.revoked({ at: ctx.clock.now(), reason: input.reason })]
      },
    }),
  }))
  .actions((b) => ({
    login: b.command({
      input: shape({ email: field.string({ format: 'email' }), password: field.string() }),
      output: shape({ sessionId: field.ref.own('session'), expiresAt: field.instant() }),
      errors: [invalidCredentials],
      auth: { public: true },
      execution: 'sync',
      handle: async (input, ctx) => {
        const cred = await ctx.asSystem('login must read credentials before a principal exists')
          .data.auth.credential.findOne({ where: { email: input.email, kind: 'password', revokedAt: null } })
        if (!cred || !(await ctx.services.auth.verify(ctx, cred.secretHash, input.password))) throw invalidCredentials()
        const expiresAt = new Date(ctx.clock.now().getTime() + ctx.config.sessionTtlSeconds * 1000)
        const s = await ctx.data.auth.session.create({ subject: cred.subject, credentialId: cred.id, expiresAt })
        return { sessionId: s.id, expiresAt }
      },
    }),
    logout: b.command({
      execution: 'sync',
      handle: async (_input, ctx) => {
        await ctx.data.auth.session.update({ where: { subject: ctx.principal.subjectId }, patch: { revokedAt: ctx.clock.now() } })
      },
    }),
    sessionEvents: b.subscription({
      event: shape({ sessionId: field.ref.own('session'), kind: field.enum(['created', 'revoked']) }),
      source: (_input, ctx) => ctx.live.entity('auth', 'session', { where: { subject: ctx.principal.subjectId } }),
    }),
  }))
  .policies((rule) => [
    rule.allow('credential', ['get', 'query', 'revoke'], {
      id: 'self',
      where: (ctx) => ({ subject: ctx.principal.subjectId }),
      fields: ['id', 'kind', 'email', 'label', 'revokedAt', 'createdAt'],
      reason: 'A user manages their own credentials.',
    }),
    rule.allow('session', ['get', 'query'], { id: 'self', where: (ctx) => ({ subject: ctx.principal.subjectId }) }),
    rule.allow('login', { public: true }),
    rule.allow(['logout', 'sessionEvents'], { when: (ctx) => ctx.principal.kind === 'user' }),
  ])
  .services((s) => ({
    verify: s.service(async (_ctx, hash: string, password: string) => argon2Verify(hash, password)),
    hash: s.service(async (_ctx, password: string) => argon2Hash(password)),
  }))
  // auth -> accounts: active only when accounts is selected.
  .contributes((c) => [
    c.to(accounts, {
      entities: {
        profile: {
          fields: {
            lastLoginAt: field.instant().optional(),
            emailVerifiedAt: field.instant().optional(),
          },
          relations: {
            credentials: relation.many.own('credential', { by: 'subject', to: 'id' }),
          },
        },
      },
      entityActions: {
        profile: (e) => ({
          resetPassword: e.command({
            input: shape({ newPassword: field.string({ minLength: 12 }) }),
            execution: 'sync',
            handle: async (input, ctx) => {
              const hash = await ctx.services.auth.hash(ctx, input.newPassword)
              await ctx.data.auth.credential.update({ where: { subject: ctx.target.id, kind: 'password' }, patch: { secretHash: hash } })
            },
          }),
        }),
      },
      policies: (rule) => [
        // "own profile" only means something when a login exists; the fragment lives here, typed against profile.
        rule.allow('profile', ['get', 'set', 'resetPassword'], {
          id: 'self',
          where: (ctx) => ({ id: ctx.principal.subjectId }),
          fields: ['id', 'displayName', 'email', 'locale', 'bio', 'lastLoginAt', 'emailVerifiedAt'],
        }),
        // A relation contributed above is usable in the same contribution.
        rule.allow('profile', ['get'], { id: 'shared-credential', where: (ctx) => ({ credentials: { some: { subject: ctx.principal.subjectId } } }) }),
      ],
      extensionPoints: {
        identityProviders: [
          {
            id: 'auth.password',
            label: 'Password',
            listFor: async (profileId) => [{ kind: 'password', label: 'Password', createdAt: new Date() }],
          },
        ],
      },
    }),
  ])
  // auth adapts itself when accounts is present.
  .conditional((w) => [
    w.when([accounts], {
      entities: {
        credential: { fields: { profileId: field.ref(accounts, 'profile').optional() } },
      },
      reactions: (r) => [
        // accounts influences auth: when a profile is deactivated, every credential of that subject is revoked.
        r.inline(accounts, 'profile.deactivated', async (event, ctx) => {
          const creds = await ctx.data.auth.credential.query({ where: { subject: event.state.id, revokedAt: null } })
          for (const c of creds.items) await ctx.invoke('auth.credential.revoke', { id: c.id, reason: 'profile deactivated' })
        }),
        // and the login timestamp flows back to the profile that auth contributed the field to.
        r.own('session.created', { timing: 'async' }, async (event, ctx) => {
          await ctx.data.accounts.profile.update({ where: { id: event.state.subject }, patch: { lastLoginAt: event.at } })
        }),
      ],
    }),
  ])
  .lifecycle({
    onTenantCreated: async (tenant, ctx) => {
      ctx.log.info({ tenant: tenant.id }, 'auth ready for tenant')
    },
  })

// ============================================================================
// 3. Two apps from the same modules.
// ============================================================================

export const directory = defineApp({
  id: 'directory',
  modules: [accounts, postgres, rest, cli], // no auth: profiles without logins
})

export const portal = defineApp({
  id: 'portal',
  modules: [accounts, auth, postgres, rest, graphql, cli],
  actions: (b) => ({
    health: b.query({ auth: { public: true }, scope: 'backend', output: shape({ ok: field.boolean() }), handle: async () => ({ ok: true }) }),
  }),
  execution: {
    'accounts.profile.deactivate': 'either', // callers may prefer async; the default stays sync
  },
  authorization: { mode: 'strict', decisionLog: 'denials' },
  policies: {
    disable: [], // rule ids such as 'accounts.profile.directory'
    add: [],
  },
})

// Derived types are exact per app and need no generator.
export type Portal = typeof portal
export type PortalProfile = AppEntities<Portal>['accounts']['profile']
//   { id: Id<'accounts.profile'>; displayName: string; email: string; locale?: string | undefined;
//     bio?: RichText | undefined; deactivatedAt?: Date | undefined;
//     lastLoginAt?: Date | undefined; emailVerifiedAt?: Date | undefined;   <- contributed by auth
//     createdAt: Date; updatedAt: Date; archivedAt?: Date | undefined; version: number }
export type DirectoryProfile = AppEntities<typeof directory>['accounts']['profile']
//   the same without lastLoginAt and emailVerifiedAt; `credentials` and `resetPassword` do not exist.
export type PortalCredential = Doc<Portal, 'auth.credential'>
//   has `profileId?: Id<'accounts.profile'> | undefined` because accounts is selected.

// ============================================================================
// 4. One deployment hosts both apps; backends and tenants are created at runtime.
// ============================================================================

export default defineDeployment({
  apps: [directory, portal],
  control: { adapter: 'postgres', url: env('PENNESTACK_CONTROL_URL') },
  placements: {
    default: { adapter: 'postgres', url: env('PENNESTACK_DATA_URL'), strategy: 'shared-tables' },
    isolated: { adapter: 'postgres', url: env('PENNESTACK_ISOLATED_URL'), strategy: 'schema-per-tenant' },
  },
  hosts: { http: { port: 3000 } },
  tenantResolution: [byHostname(), byHeader('x-pennestack-tenant'), byToken()],
  operator: { secret: env('PENNESTACK_OPERATOR_SECRET') },
  telemetry: { otlp: env('OTEL_EXPORTER_OTLP_ENDPOINT') },
})

// ============================================================================
// 5. Calling actions: the CLI, tests and modules all go through the invoker.
// ============================================================================

export async function example(client: AppClient<Portal>) {
  // Operator work at deployment scope: create a backend running `portal`, then a tenant in it.
  const backend = await client.invoke('core.backends.create', { name: 'acme', app: 'portal', placement: 'default' })
  const tenant = await client.invoke('core.tenants.create', { backendId: backend.id, name: 'Acme NV', domains: ['acme.example'] })

  // Tenant-scoped calls: scope and principal come from the client's profile (token, backend, tenant).
  const scoped = client.as({ backend: backend.id, tenant: tenant.id, token: process.env.ACME_TOKEN })
  const { profileId } = await scoped.invoke('accounts.register', { displayName: 'Jens', email: 'jens@acme.example' })
  const page = await scoped.invoke('accounts.profile.search', { text: 'Je', first: 10 })
  const receipt = await scoped.invoke('accounts.profile.deactivate', { id: profileId }, { prefer: 'async' })
  //    ^ { commandId, status: 'accepted' } because the app declared `either`

  for await (const ev of scoped.subscribe('auth.sessionEvents', {})) {
    // live events, re-authorized per event, resumable with ev.state
    void ev
  }
  return page.items.map((p) => p.displayName)
}

// Helpers assumed from the core or from a module; shown so the sketch reads top to bottom.
declare function byHostname(): unknown
declare function byHeader(name: string): unknown
declare function byToken(): unknown
declare function argon2Verify(hash: string, password: string): Promise<boolean>
declare function argon2Hash(password: string): Promise<string>
