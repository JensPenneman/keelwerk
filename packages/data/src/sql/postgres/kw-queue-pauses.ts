/**
 * `kw_queue_pauses`: a paused queue, in the control store's root only (S-121). A null `namespace_id`
 * pauses the queue in every namespace of the deployment, including one provisioned later; a null
 * `scope_id` pauses every scope of the namespace (or of every namespace). A fetcher for namespace N
 * and queue Q is paused by a row with `(namespace_id is null or namespace_id = N)`, queue Q and
 * either a null scope or the scope it is about to take from.
 */
export function kwQueuePauses(root: string): readonly string[] {
  return [
    `create table "${root}".kw_queue_pauses (
  namespace_id text,
  queue text not null,
  scope_id uuid,
  paused_by jsonb not null,
  reason text not null,
  paused_at timestamptz(3) not null,
  unique nulls not distinct (namespace_id, queue, scope_id)
)`,
  ];
}
