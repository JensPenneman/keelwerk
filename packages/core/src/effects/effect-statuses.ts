/**
 * The statuses of an effect, in the order every surface prints them. The `core.effect` entity and
 * the status view declare their `status` member from this one list, so both stay one enum.
 */
export const effectStatuses = ['requested', 'succeeded', 'failed', 'abandoned'] as const;
