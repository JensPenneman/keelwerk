/** `kw_rate_buckets`: token buckets keyed by the HMAC of the bucket key (section 12.2, S-36). */
export function kwRateBuckets(root: string): readonly string[] {
  return [
    `create table "${root}".kw_rate_buckets (
  scope_id uuid,
  bucket bytea,
  tokens double precision not null,
  refilled_at timestamptz(3) not null,
  primary key (scope_id, bucket)
)`,
  ];
}
