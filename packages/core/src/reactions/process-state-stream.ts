/**
 * The `kw_stream_records` stream that holds process state caches (S-124), keyed by the instance's
 * stream id. It is no declared stream of any module: the kernel alone writes it, and no module
 * names it.
 */
export const processStateStream = 'kernel:process-state';
