import { expectTypeOf, test } from 'vitest';
import type { ErrorIssue } from '../errors/error-issue.ts';
import type { ErrorSpec } from '../errors/error-spec.ts';
import type { RuleMatch } from '../errors/rule-match.ts';
import type { WireError } from '../errors/wire-error.ts';
import type { DecisionRecord } from '../events/decision-record.ts';
import type { EventEnvelope } from '../events/event-envelope.ts';
import type { EventMeta } from '../events/event-meta.ts';
import type { EventSelector } from '../events/event-selector.ts';
import type { EventStore } from '../events/event-store.ts';
import type { FlagRead } from '../events/flag-read.ts';
import type { MergeReport } from '../events/merge-report.ts';
import type { NewEvent } from '../events/new-event.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import type { StreamAppend } from '../events/stream-append.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import type { JobGroup } from '../jobs/job-group.ts';
import type { JobRetry } from '../jobs/job-retry.ts';
import type { JobSpec } from '../jobs/job-spec.ts';
import type { Logger } from '../observability/logger.ts';
import type { Telemetry } from '../observability/telemetry.ts';
import type { ActorRef } from '../principals/actor-ref.ts';
import type { AnonymousPrincipal } from '../principals/anonymous-principal.ts';
import type { Membership } from '../principals/membership.ts';
import type { OperatorPrincipal } from '../principals/operator-principal.ts';
import type { PrincipalBase } from '../principals/principal-base.ts';
import type { PrincipalRef } from '../principals/principal-ref.ts';
import type { ServicePrincipal } from '../principals/service-principal.ts';
import type { SystemPrincipal } from '../principals/system-principal.ts';
import type { UserPrincipal } from '../principals/user-principal.ts';
import type { AllRequest } from '../protocol/all-request.ts';
import type { ArchiveDraft } from '../protocol/archive-draft.ts';
import type { AskRequest } from '../protocol/ask-request.ts';
import type { CancelTimerEffect } from '../protocol/cancel-timer-effect.ts';
import type { ComputeRequest } from '../protocol/compute-request.ts';
import type { CreateDraft } from '../protocol/create-draft.ts';
import type { Draft } from '../protocol/draft.ts';
import type { EffectDraft } from '../protocol/effect-draft.ts';
import type { EnqueueEffect } from '../protocol/enqueue-effect.ts';
import type { EventDraft } from '../protocol/event-draft.ts';
import type { ExternalEffect } from '../protocol/external-effect.ts';
import type { FlagRequest } from '../protocol/flag-request.ts';
import type { IdRequest } from '../protocol/id-request.ts';
import type { InvokeEffect } from '../protocol/invoke-effect.ts';
import type { LoadRequest } from '../protocol/load-request.ts';
import type { MaybeRequest } from '../protocol/maybe-request.ts';
import type { Pending } from '../protocol/pending.ts';
import type { PerformRequest } from '../protocol/perform-request.ts';
import type { QueryDescription } from '../protocol/query-description.ts';
import type { RandomRequest } from '../protocol/random-request.ts';
import type { Request } from '../protocol/request.ts';
import type { RestoreDraft } from '../protocol/restore-draft.ts';
import type { SecretRequest } from '../protocol/secret-request.ts';
import type { SetTimerEffect } from '../protocol/set-timer-effect.ts';
import type { SettleEffect } from '../protocol/settle-effect.ts';
import type { UpdateDraft } from '../protocol/update-draft.ts';
import type { Empty } from '../types/empty.ts';
import type { AdapterCapabilities } from './adapter-capabilities.ts';
import type { AdapterEnvironment } from './adapter-environment.ts';
import type { AppliedMigration } from './applied-migration.ts';
import type { BucketStore } from './bucket-store.ts';
import type { BucketTake } from './bucket-take.ts';
import type { Catalogue } from './catalogue.ts';
import type { ChangeFeedSource } from './change-feed-source.ts';
import type { ColumnSpec } from './column-spec.ts';
import type { DataAdapter } from './data-adapter.ts';
import type { DataAdapterFactory } from './data-adapter-factory.ts';
import type { DataKey } from './data-key.ts';
import type { DerivedIndexField } from './derived-index-field.ts';
import type { EncryptedQueryCapabilities } from './encrypted-query-capabilities.ts';
import type { EntityDescriptor } from './entity-descriptor.ts';
import type { ExternalMapping } from './external-mapping.ts';
import type { FieldConstraints } from './field-constraints.ts';
import type { FieldDescriptor } from './field-descriptor.ts';
import type { ForeignKeySpec } from './foreign-key-spec.ts';
import type { IndexDescriptor } from './index-descriptor.ts';
import type { IndexSpec } from './index-spec.ts';
import type { JobAttempt } from './job-attempt.ts';
import type { JobStore } from './job-store.ts';
import type { KeyedUpdate } from './keyed-update.ts';
import type { MigrationFile } from './migration-file.ts';
import type { MigrationStepContext } from './migration-step-context.ts';
import type { NormalizerRef } from './normalizer-ref.ts';
import type { PersonalParams } from './personal-params.ts';
import type { PlacementConfig } from './placement-config.ts';
import type { Receipt } from './receipt.ts';
import type { ReceiptStore } from './receipt-store.ts';
import type { RelationDescriptor } from './relation-descriptor.ts';
import type { RowPage } from './row-page.ts';
import type { RowQuery } from './row-query.ts';
import type { RowStore } from './row-store.ts';
import type { SchemaOperations } from './schema-operations.ts';
import type { ScopeKeyStore } from './scope-key-store.ts';
import type { SealedValue } from './sealed-value.ts';
import type { SearchIndexDescriptor } from './search-index-descriptor.ts';
import type { SearchRequest } from './search-request.ts';
import type { SerialStore } from './serial-store.ts';
import type { ShapeRef } from './shape-ref.ts';
import type { StoredJob } from './stored-job.ts';
import type { StoredJobSpec } from './stored-job-spec.ts';
import type { SubjectKeyStore } from './subject-key-store.ts';
import type { TableSpec } from './table-spec.ts';
import type { TrackSnapshot } from './track-snapshot.ts';
import type { Unit } from './unit.ts';
import type { UnitOptions } from './unit-options.ts';
import type { UsageStore } from './usage-store.ts';
import type { WorkClassStats } from './work-class-stats.ts';
import type { WrappedScopeKey } from './wrapped-scope-key.ts';

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AnyMembers<T> = T extends unknown
  ? { [K in keyof T]-?: 0 extends 1 & T[K] ? K : never }[keyof T]
  : never;
type EmptyMembers<T> = T extends unknown
  ? { [K in keyof T]-?: Eq<T[K], Empty> extends true ? K : never }[keyof T]
  : never;

/** Every interface the entry exports for F-02 to F-08. */
type Interfaces =
  | EventMeta
  | ActorRef
  | AdapterCapabilities
  | AdapterEnvironment
  | AllRequest
  | AnonymousPrincipal
  | AppliedMigration
  | ArchiveDraft
  | AskRequest
  | BucketStore
  | BucketTake
  | CancelTimerEffect
  | Catalogue
  | ChangeFeedSource
  | ColumnSpec
  | ComputeRequest
  | CreateDraft
  | DataAdapter
  | DataAdapterFactory
  | DataKey
  | DecisionRecord
  | DerivedIndexField
  | Draft
  | EffectDraft
  | EncryptedQueryCapabilities
  | EnqueueEffect
  | EntityDescriptor
  | ErrorIssue
  | ErrorSpec
  | EventDraft
  | EventEnvelope
  | EventSelector
  | EventStore
  | ExternalEffect
  | ExternalMapping
  | FieldConstraints
  | FieldDescriptor
  | FlagRead
  | FlagRequest
  | ForeignKeySpec
  | IdRequest
  | IndexDescriptor
  | IndexSpec
  | InvokeEffect
  | JobAttempt
  | JobGroup
  | JobRetry
  | JobSpec
  | JobStore
  | KeyedUpdate
  | LoadRequest
  | Logger
  | MaybeRequest
  | Membership
  | MergeReport
  | MigrationFile
  | MigrationStepContext
  | NewEvent
  | NormalizerRef
  | OperatorPrincipal
  | Pending
  | PerformRequest
  | PersonalParams
  | PlacementConfig
  | PrincipalBase
  | PrincipalRef
  | QueryDescription
  | RandomRequest
  | Receipt
  | ReceiptStore
  | RecordedRead
  | RelationDescriptor
  | Request<unknown>
  | RestoreDraft
  | RowPage
  | RowQuery
  | RowStore
  | RuleMatch
  | SchemaOperations
  | ScopeKeyStore
  | SealedValue
  | SearchIndexDescriptor
  | SearchRequest
  | SecretRequest
  | SerialStore
  | ServicePrincipal
  | SetTimerEffect
  | SettleEffect
  | ShapeRef
  | StoredJob
  | StoredJobSpec
  | StreamAppend
  | StreamRef
  | SubjectKeyStore
  | SystemPrincipal
  | TableSpec
  | Telemetry
  | TrackSnapshot
  | Unit
  | UnitOptions
  | UpdateDraft
  | UsageStore
  | UserPrincipal
  | WireError
  | WorkClassStats
  | WrappedScopeKey;

test('no member of any exported interface is any', () => {
  expectTypeOf<AnyMembers<Interfaces>>().toBeNever();
});

test('no member of any exported interface is an empty object type', () => {
  expectTypeOf<EmptyMembers<Interfaces>>().toBeNever();
});
