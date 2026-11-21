/**
 * What one OpenAPI document says, counted the same way for both producers. `operations`: the
 * (path, method) pairs; `schemas`: the keys of `components.schemas`; error responses are the 4xx, the
 * 5xx and `default`. `errorMediaTypes`: the sorted media types of the error responses;
 * `operationsWithDeclaredErrors`: operations of actions that declare errors whose error responses
 * hold one of those codes as a `const`; `declaredCodesDocumented`: the distinct declared codes that
 * are not core codes and are held so anywhere. `pagedOperations`: operations of actions with a page
 * output that take `first` and `after` (as parameters or as body properties); `linkHeader`: some
 * response documents `Link`. `acceptedResponses`, `preferHeader` and `idempotencyKeyHeader`: the
 * operations with a 202 response, with a `Prefer` header parameter and with an `Idempotency-Key`
 * header parameter; `receiptSchema`: a schema requires `commandId` and holds `status` as the
 * constant 'accepted'. `responseHeaders`: the sorted lower-case names among keelwerk-version,
 * deprecation, sunset and link that any response documents.
 */
interface DocumentFacts {
  readonly producer: '@keelwerk/transport-rest' | '@orpc/openapi';
  readonly openapi: string;
  readonly operations: number;
  readonly schemas: number;
  readonly problemDetails: {
    readonly errorMediaTypes: readonly string[];
    readonly operationsWithDeclaredErrors: number;
    readonly declaredCodesDocumented: number;
  };
  readonly pagination: { readonly pagedOperations: number; readonly linkHeader: boolean };
  readonly executionModes: {
    readonly acceptedResponses: number;
    readonly preferHeader: number;
    readonly idempotencyKeyHeader: number;
    readonly receiptSchema: boolean;
  };
  readonly versionHeaders: { readonly responseHeaders: readonly string[] };
}

/**
 * The measured comparison of the two OpenAPI documents of one app at one API version (F-30): the
 * document of `@keelwerk/transport-rest` against oRPC's own. It is committed as `comparison.json`
 * and written by the golden of the comparison test.
 */
export interface OpenapiComparison {
  readonly format: 'keelwerk.orpc-comparison/1';
  readonly app: string;
  readonly apiVersion: string;
  readonly actions: number;
  readonly own: DocumentFacts;
  readonly orpc: DocumentFacts;
  /** One line per differing leaf, in member order: "<path>: own <JSON>, orpc <JSON>". */
  readonly differences: readonly string[];
}
