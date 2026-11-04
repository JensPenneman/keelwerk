import { sha256 } from '@keelwerk/core/crypto';

const limit = 63;

/** `<table>_<column>_<suffix>`, shortened with a hash of the full name when it exceeds PostgreSQL's 63 bytes (section 14.4.2). */
export function constraintName(table: string, column: string, suffix: string): string {
  const full = `${table}_${column}_${suffix}`;
  return full.length <= limit ? full : `${full.slice(0, limit - 8)}${sha256(full).slice(0, 8)}`;
}
