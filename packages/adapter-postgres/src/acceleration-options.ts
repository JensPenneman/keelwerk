/**
 * What `postgresAdapter` takes to run without the accelerations the server offers (14.3.3): the
 * kernel then takes the paths of the fallback report, which proves them on a real server.
 */
export interface AccelerationOptions {
  readonly accelerations?: {
    /** `false`: report `rowLocks: false`, so units use expected versions and counter rows. Default `true`. */
    readonly rowLocks?: boolean;
    /** `false`: report `changeFeed: 'poll'`, send no `NOTIFY` and open no `LISTEN` connection. Default `true`. */
    readonly notify?: boolean;
  };
}
