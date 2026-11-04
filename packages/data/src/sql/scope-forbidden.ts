import { KeelwerkError } from '@keelwerk/core';

export function scopeForbidden(message: string, details: Record<string, unknown>): KeelwerkError {
  return new KeelwerkError({ kind: 'forbidden', code: 'core.forbidden', message, details });
}
