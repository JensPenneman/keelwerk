/** One version of the deployment master key: 32 bytes from the secret providers. */
export interface MasterKey {
  readonly version: number;
  readonly material: Uint8Array;
}

/** Where the deployment master key comes from; a key-management module later. */
export interface MasterKeySource {
  /** The key new wraps use. */
  current(): Promise<MasterKey>;
  /** An older version, to unwrap keys wrapped before a rotation; undefined when it is gone. */
  byVersion(version: number): Promise<MasterKey | undefined>;
}
