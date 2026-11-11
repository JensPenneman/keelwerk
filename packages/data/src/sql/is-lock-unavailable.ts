/** SQLSTATE 55P03, `lock_not_available`: a statement waited longer than `lock_timeout` for a row lock. */
export function isLockUnavailable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '55P03';
}
