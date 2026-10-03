// Raises the iPhone app's build number (CURRENT_PROJECT_VERSION) by one in
// every target at once. The app and its LiveGame extension must carry the
// same build number, or App Store Connect rejects the upload.
//
//   npm run ios:bump
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url);
const pbx = readFileSync(path, 'utf8');
const builds = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
if (!builds.length) throw new Error('No CURRENT_PROJECT_VERSION found');
const next = Math.max(...builds) + 1;
writeFileSync(path, pbx.replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${next};`));
console.log(`Build number is now ${next} (was ${[...new Set(builds)].join(', ')}).`);
