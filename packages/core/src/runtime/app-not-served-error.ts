/**
 * What the runtime's `surface` and `registry` throw for an app id this process does not serve. It is
 * a `RangeError`, so a caller that only expects an out-of-range argument still holds, and a caller
 * that must tell this case from any other failure checks it with `isAppNotServedError`.
 */
export class AppNotServedError extends RangeError {
  override readonly name: string = 'AppNotServedError';
  readonly appId: string;

  constructor(appId: string) {
    super(`The process does not serve app "${appId}".`);
    this.appId = appId;
  }
}
