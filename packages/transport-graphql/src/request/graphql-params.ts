/** One GraphQL operation request: the document text, the operation to run and its variables. */
export interface GraphqlParams {
  readonly query: string;
  readonly operationName?: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}
