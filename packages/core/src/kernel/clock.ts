/** The invocation's time source: the kernel takes it once when execution begins (section 7.9.3). */
export interface Clock {
  now(): Temporal.Instant;
}
