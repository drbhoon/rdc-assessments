/**
 * Mount prefix for the app, without a trailing slash.
 *
 * Vite sets import.meta.env.BASE_URL from the `base` option in
 * vite.config.js — "/eval/" on the HR platform, "/" everywhere else. Trimming
 * the trailing slash gives "/eval" or "", so withBase('/api/...') composes
 * cleanly and root-mounted builds are unaffected.
 *
 * Vite rewrites asset URLs it can see (index.html, imported modules) but not
 * strings written in JSX — fetch targets, <img src>, <a href> and share links
 * all go through withBase().
 */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export const withBase = (path) => `${BASE}${path}`;
