/** How a change to a surface affects its clients (section 13.8, step 9). */
export type SurfaceChangeClass = 'breaking' | 'dangerous' | 'additive' | 'neutral';

/** What kind of difference two surfaces show; `classifySurfaceChange` maps each to its class. */
export type SurfaceChangeKind =
  | 'actionRemoved'
  | 'actionAdded'
  | 'actionKindChanged'
  | 'executionLeftSync'
  | 'executionChanged'
  | 'errorKindChanged'
  | 'errorAdded'
  | 'errorRemoved'
  | 'declaredErrorAdded'
  | 'declaredErrorRemoved'
  | 'entityAdded'
  | 'entityRemoved'
  | 'eventAdded'
  | 'eventRemoved'
  | 'outputFieldRemoved'
  | 'outputFieldAdded'
  | 'outputMadeOptional'
  | 'outputMadeRequired'
  | 'outputTypeChanged'
  | 'outputEnumValueAdded'
  | 'outputEnumValueRemoved'
  | 'outputUnionMemberAdded'
  | 'outputSchemaChanged'
  | 'inputFieldRemoved'
  | 'inputRequiredFieldAdded'
  | 'inputOptionalFieldAdded'
  | 'inputMadeRequired'
  | 'inputMadeOptional'
  | 'inputTypeChanged'
  | 'inputTypeNarrowed'
  | 'inputTypeWidened'
  | 'inputEnumValueRemoved'
  | 'inputEnumValueAdded'
  | 'inputSchemaChanged'
  | 'authChanged'
  | 'scopeChanged'
  | 'instanceChanged'
  | 'moduleChanged'
  | 'metadataChanged';

/** One classified difference between two surfaces. */
export interface SurfaceChange {
  readonly kind: SurfaceChangeKind;
  readonly class: SurfaceChangeClass;
  /** An action, entity, event or error reference, then the field path below it. */
  readonly ref: string;
  readonly message: string;
}
