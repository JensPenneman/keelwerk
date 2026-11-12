/** What `core.retireApiVersion` answers: the retired version, the floor, and the tenants and backends re-pinned to it. */
export interface ApiVersionRetirement {
  readonly app: string;
  readonly version: string;
  readonly floor: string;
  readonly tenants: number;
  readonly backends: number;
}
