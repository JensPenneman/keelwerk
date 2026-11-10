/** A scope's epoch moved at connect because a restore rewound it (section 14.7.6, S-119). */
export interface EpochBump {
  readonly scopeId: string;
  readonly from: number;
  readonly to: number;
  readonly reason: 'identity' | 'timeline' | 'counter' | 'anchor';
}
