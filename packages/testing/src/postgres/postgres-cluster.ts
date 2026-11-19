/** The container and superuser URL of one PostgreSQL cluster: what the connection guard reads. */
export interface PostgresCluster {
  readonly containerId: string;
  readonly adminUrl: string;
}
