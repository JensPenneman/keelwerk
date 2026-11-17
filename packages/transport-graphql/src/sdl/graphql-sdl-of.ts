import { lexicographicSortSchema, printSchema } from 'graphql';
import type { GraphqlProjection } from '../schema/graphql-projection.ts';

/** The SDL of a schema as it is committed (13.7, 16.6.7): the lexicographically sorted print, LF line ends and one trailing newline, no header; it equals what the served schema prints. */
export function graphqlSdlOf(projection: GraphqlProjection): string {
  return `${printSchema(lexicographicSortSchema(projection.schema))}\n`;
}
