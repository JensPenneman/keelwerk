import type { SurfaceChangeClass, SurfaceChangeKind } from './surface-change.ts';

/**
 * The class of one kind of difference, covering every case of section 13.8 step 9. Breaking: an
 * action or an output field removed, an output field made optional, a new required input field, an
 * input type narrowed or an input enum value removed, an execution mode changed away from `sync`,
 * an error code given another kind, an action's auth, scope or instance flag changed. Dangerous: an output enum value or a union member added, a
 * declared error added. Anything unknown about a schema fails closed as breaking. No case assumes a
 * translation between versions.
 */
export function classifySurfaceChange(kind: SurfaceChangeKind): SurfaceChangeClass {
  switch (kind) {
    case 'actionRemoved':
    case 'actionKindChanged':
    case 'executionLeftSync':
    case 'errorKindChanged':
    case 'authChanged':
    case 'scopeChanged':
    case 'instanceChanged':
    case 'entityRemoved':
    case 'eventRemoved':
    case 'outputFieldRemoved':
    case 'outputMadeOptional':
    case 'outputTypeChanged':
    case 'outputSchemaChanged':
    case 'inputRequiredFieldAdded':
    case 'inputFieldRemoved':
    case 'inputMadeRequired':
    case 'inputTypeChanged':
    case 'inputTypeNarrowed':
    case 'inputEnumValueRemoved':
    case 'inputSchemaChanged':
      return 'breaking';
    case 'outputEnumValueAdded':
    case 'outputUnionMemberAdded':
    case 'declaredErrorAdded':
      return 'dangerous';
    case 'actionAdded':
    case 'executionChanged':
    case 'errorAdded':
    case 'entityAdded':
    case 'eventAdded':
    case 'outputFieldAdded':
    case 'outputMadeRequired':
    case 'inputOptionalFieldAdded':
    case 'inputMadeOptional':
    case 'inputTypeWidened':
    case 'inputEnumValueAdded':
      return 'additive';
    case 'declaredErrorRemoved':
    case 'errorRemoved':
    case 'outputEnumValueRemoved':
    case 'moduleChanged':
    case 'metadataChanged':
      return 'neutral';
  }
}
