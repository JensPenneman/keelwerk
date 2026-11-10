/** One publishable package of the lockstep release. */
export interface ReleasePackage {
  readonly name: string;
  /** The directory below packages/, such as 'core'. */
  readonly directory: string;
  readonly version: string;
  /** Workspace packages it needs at run time: dependencies, peerDependencies, optionalDependencies. */
  readonly dependsOn: readonly string[];
  /** The file name `pnpm pack` gives it: '@keelwerk/core' 0.1.0 becomes 'keelwerk-core-0.1.0.tgz'. */
  readonly tarball: string;
}
