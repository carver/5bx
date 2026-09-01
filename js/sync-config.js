/*
 * Which Firebase project this app syncs to.
 *
 * Both values are public. They identify the project; they do not grant access
 * to anything. Firestore security rules are what control access, and they are
 * checked on the server against every request. Firebase's own documentation
 * treats these as safe to ship in client code, which is just as well, since a
 * site with no build step has nowhere to hide them.
 *
 * Blank by default, which leaves sync switched off and the app behaving
 * exactly as it did before: local-only, no network, nothing to configure.
 * Run `npm run setup:sync` to fill this in from your own Firebase project.
 */
export const SYNC_CONFIG = {
  projectId: 'fivebx-31d11',
  apiKey: 'AIzaSyBYNTyGFMFnmr_6jyfxQOBSNJ2UYwXkFzU',
};

export function isSyncConfigured(config = SYNC_CONFIG) {
  return Boolean(config.projectId && config.apiKey);
}
