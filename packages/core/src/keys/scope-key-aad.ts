import { encodeAad } from './encode-aad.ts';

/** Which row of `kw_scope_keys` a wrapped key belongs to (S-55). */
export interface ScopeKeyBinding {
  readonly level: 'deployment' | 'backend' | 'tenant';
  readonly scopeId: string;
  readonly version: number;
}

/** The associated data of a wrapped scope key. */
export function scopeKeyAad(binding: ScopeKeyBinding): Uint8Array {
  return encodeAad([
    'keelwerk/scope-key/1',
    binding.level,
    binding.scopeId,
    String(binding.version),
  ]);
}
