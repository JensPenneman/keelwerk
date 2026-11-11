import type { GraphqlParams } from './graphql-params.ts';

/** What a request body holds: one request or a batch of them (the answer has the same form). */
export interface GraphqlRequestBody {
  readonly batch: boolean;
  readonly params: readonly GraphqlParams[];
}
