/** One artefact a producer implies: the absolute path and the exact text. */
export interface ProducerFile {
  readonly path: string;
  readonly text: string;
}
