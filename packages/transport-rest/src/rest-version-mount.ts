import type { ApiSurface } from '@keelwerk/core';
import type { OpenApiDocuments } from './openapi-documents.ts';
import type { RouteTable } from './route-table.ts';

/** What the REST handler serves at one API version: its surface, routes, problem pages and OpenAPI documents. */
export interface RestVersionMount {
  readonly surface: ApiSurface;
  readonly table: RouteTable;
  readonly problem: (code: string) => Response | undefined;
  readonly documents: OpenApiDocuments;
}
