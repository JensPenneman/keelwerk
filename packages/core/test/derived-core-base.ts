import { defineEntity } from '../src/dsl/define-entity.ts';
import { defineModuleBase } from '../src/dsl/define-module-base.ts';
import { extensionPoint } from '../src/dsl/extension-point.ts';
import type { AdmissionRule } from '../src/edge/admission-rule.ts';
import type { PrincipalEnricher } from '../src/edge/principal-enricher.ts';
import type { PrincipalResolver } from '../src/edge/principal-resolver.ts';
import { field } from '../src/fields/field.ts';
import { shape } from '../src/fields/shape.ts';
import type { StandardSchemaV1 } from '../src/fields/standard-schema-v1.ts';
import { flagTargetingSchema } from '../src/flags/flag-targeting-schema.ts';
import type { LiveCarrier } from '../src/live/live-carrier.ts';
import type { LiveHub } from '../src/live/live-hub.ts';
import type { TransportAdapter } from '../src/transport/transport-adapter.ts';
import { derivedEffectAttempt } from './derived-effect-attempt.ts';

declare const configSchema: StandardSchemaV1<Record<string, unknown>, Record<string, unknown>>;
declare const document: StandardSchemaV1<Record<string, unknown>, Record<string, unknown>>;
const status = field.enum(['active', 'suspended']).default('active');

/**
 * What the DSL derives from the same definitions, with isolatedDeclarations off: the hand-written
 * `CoreBase` must be exactly this (decision 104). Read by the type tests only.
 */
export const derivedCoreBase = defineModuleBase({
  id: 'core',
  version: '0.0.0',
  extensionPoints: {
    transports: extensionPoint.set<TransportAdapter>(),
    principalResolvers: extensionPoint.ordered<PrincipalResolver>(),
    principalEnrichers: extensionPoint.set<PrincipalEnricher>(),
    invocationMiddleware: extensionPoint.ordered<AdmissionRule>(),
    liveHub: extensionPoint.single<LiveHub>({ min: 0 }),
    liveCarriers: extensionPoint.set<LiveCarrier>(),
  },
  entities: {
    backend: defineEntity({
      prefix: 'bknd',
      fields: {
        name: field.string().unique(),
        app: field.string(),
        placement: field.string(),
        apiVersion: field.string().optional(),
        config: field.json(configSchema).optional(),
        status,
      },
      tenancy: 'deployment',
      generated: { create: false },
    }),
    tenant: defineEntity({
      prefix: 'tnt',
      fields: {
        backendId: field.ref.own('backend'),
        name: field.string(),
        placement: field.string().optional(),
        apiVersion: field.string().optional(),
        domains: field.list(field.string()),
        status,
      },
      events: {
        entered: shape({ reason: field.string() }),
        hookFailed: shape({ hook: field.string() }),
        hookCompleted: shape({ hook: field.string() }),
      },
      evolve: {
        entered: (state) => state,
        hookFailed: (state) => state,
        hookCompleted: (state) => state,
      },
      tenancy: 'deployment',
      generated: { history: true, create: false },
    }),
    domain: defineEntity({
      prefix: 'dom',
      fields: {
        hostname: field.string().unique(),
        backendId: field.ref.own('backend'),
        tenantId: field.ref.own('tenant'),
      },
      tenancy: 'deployment',
      generated: { set: false },
    }),
    placement: defineEntity({
      prefix: 'plc',
      fields: {
        name: field.string().unique(),
        adapter: field.string(),
        strategy: field.enum(['shared-tables', 'schema-per-tenant', 'database-per-tenant']),
      },
      tenancy: 'deployment',
      generated: { set: false },
    }),
    namespace: defineEntity({
      prefix: 'nsp',
      fields: {
        placementId: field.ref.own('placement'),
        appId: field.string(),
        tenantId: field.ref.own('tenant').optional(),
        root: field.string(),
      },
      tenancy: 'deployment',
      generated: { set: false },
    }),
    operatorToken: defineEntity({
      prefix: 'otk',
      fields: {
        label: field.string(),
        publicId: field.string().unique(),
        verifier: field.verifier(),
        expiresAt: field.instant(),
        revokedAt: field.instant().optional(),
      },
      tenancy: 'deployment',
      generated: { set: false },
    }),
    commandReceipt: defineEntity({
      prefix: 'rcpt',
      fields: {
        commandId: field.string().unique(),
        action: field.string(),
        fingerprint: field.string(),
        principal: field.json(document).optional().hidden(),
        principalResolver: field.string().optional(),
        principalId: field.string().optional(),
        status: field.enum(['pending', 'accepted', 'completed', 'failed']),
        outcome: field.json(document).optional(),
        apiVersion: field.string(),
        transport: field.string(),
        remoteAddress: field.string().optional(),
        userAgent: field.string().optional(),
        clientId: field.string().optional(),
        clientSeq: field.integer().optional(),
        expiresAt: field.instant(),
        acknowledgedAt: field.instant().optional(),
      },
      history: 'state',
      tenancy: 'invocation',
      generated: { set: false },
    }),
    effect: defineEntity({
      prefix: 'eff',
      fields: {
        type: field.string(),
        commandId: field.string(),
        status: field.enum(['requested', 'succeeded', 'failed', 'abandoned']),
        attempts: field.integer().default(0),
        performer: field.enum(['executor', 'external']),
        input: field.json(document).optional(),
        eventIds: field.list(field.string()),
        continuation: field.string().optional(),
        continuationWith: field.json(document).optional(),
        key: field.string().optional(),
        runAt: field.instant().optional(),
        deadline: field.instant().optional(),
        output: field.json(document).optional(),
        error: field.json(document).optional(),
        outputDigest: field.string().optional(),
        settledAt: field.instant().optional(),
        principalResolver: field.string().optional().hidden(),
        principalId: field.string().optional().hidden(),
      },
      tenancy: 'invocation',
      generated: { set: false },
    }),
    process: defineEntity({
      prefix: 'proc',
      fields: {
        name: field.string().optional(),
        node: field.string(),
        roles: field.list(field.enum(['serve', 'work'])),
        buildId: field.string(),
        revision: field.integer(),
        state: field.enum(['starting', 'ready', 'draining', 'stopped']),
        heartbeatAt: field.instant(),
      },
      tenancy: 'deployment',
      history: 'state',
      generated: { set: false },
    }),
    flag: defineEntity({
      prefix: 'flg',
      fields: {
        slot: field.string().unique(),
        key: field.string(),
        backendId: field.ref.own('backend').optional(),
        targeting: field.json(flagTargetingSchema),
        previous: field.json(flagTargetingSchema).optional(),
        reason: field.string(),
      },
      tenancy: 'deployment',
      generated: { set: false, history: true },
    }),
  },
  streams: { effectAttempt: derivedEffectAttempt },
});
