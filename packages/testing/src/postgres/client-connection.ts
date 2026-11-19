/** One client backend of `pg_stat_activity`. */
export interface ClientConnection {
  readonly pid: number;
  readonly applicationName: string;
  readonly database: string;
  readonly state: string;
}
