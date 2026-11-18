/** Leaves the app for another site (an OAuth client's redirect URI): its own module, so that tests can stand in. */
export function leave(url: string) {
  location.assign(url);
}
