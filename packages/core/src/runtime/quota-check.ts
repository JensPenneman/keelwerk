/** The input of `core.quota.set` as the control route checks it. */
export interface QuotaCheck {
  readonly dimension: string;
  readonly backendId: string;
  readonly tenantId: string;
  readonly limit: string;
  readonly reason: string;
}
