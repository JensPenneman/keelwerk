/**
 * The outbound policy of a work process (12.3, S-131): CIDR blocks exempted from the refusal of
 * special-purpose addresses, such as `['127.0.0.0/8', '::1/128']` for tests that post to a local
 * server. Absent: every special-purpose address is refused.
 */
export interface EgressPolicy {
  readonly allow?: readonly string[];
}
