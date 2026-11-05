/** The producers of `keelwerk generate`, in the order they run (`--only` names one). */
export const producerNames = [
  'manifests',
  'surfaces',
  'app',
  'openapi',
  'cli',
  'migrations',
] as const;

/** One producer of `keelwerk generate`. */
export type ProducerName = (typeof producerNames)[number];
