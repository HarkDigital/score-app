// The pages scores.phade.app serves beside the API: the privacy policy and
// support pages the App Store listing links to, and that the app's footer
// opens. They're read once at startup from server/site/ (deploy.sh copies
// the folder with the rest of server/).

import fs from 'node:fs';

const PAGES = {
  '/privacy': ['privacy.html', 'text/html; charset=utf-8'],
  '/support': ['support.html', 'text/html; charset=utf-8'],
  '/legal.css': ['legal.css', 'text/css; charset=utf-8'],
};

const files = Object.fromEntries(Object.entries(PAGES).map(([path, [file, type]]) => [
  path,
  { type, body: fs.readFileSync(new URL(`./site/${file}`, import.meta.url)) },
]));

// { type, body } for a GET or HEAD of one of the pages ("/privacy/" too), or
// null for anything else (the API's routes).
export function sitePage(method, pathname) {
  if (method !== 'GET' && method !== 'HEAD') return null;
  return files[pathname.replace(/\/+$/, '')] ?? null;
}
