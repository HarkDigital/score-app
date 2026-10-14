// Builds the Android app, signed with the release key:
//   npm run android:apk   an APK to hand to testers (dist/PhadeScores.apk)
//   npm run android:aab   an app bundle to upload to Google Play (dist/PhadeScores.aab)
// Raises the versionCode first (Android won't install an older one over a
// newer one, and Play refuses a code it has seen), syncs the Capacitor
// config, builds with Gradle on Java 21 (Homebrew's openjdk@21; Android
// Studio's own Java is too new for this Gradle), and copies the result to
// dist/ (not in git).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const bundle = process.argv.includes('aab');
const root = fileURLToPath(new URL('..', import.meta.url));
const android = `${root}android`;
const gradleFile = `${android}/app/build.gradle`;

const java = ['/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home', '/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home']
  .find((home) => existsSync(`${home}/bin/java`));
if (!java) throw new Error('Java 21 not found: brew install openjdk@21');
if (!existsSync(`${android}/keystore.properties`)) throw new Error('android/keystore.properties is missing (the release key); see README');

const gradle = readFileSync(gradleFile, 'utf8');
const code = Number(gradle.match(/versionCode (\d+)/)[1]) + 1;
writeFileSync(gradleFile, gradle.replace(/versionCode \d+/, `versionCode ${code}`));
console.log(`versionCode ${code}`);

const env = { ...process.env, JAVA_HOME: java, ANDROID_HOME: process.env.ANDROID_HOME ?? `${homedir()}/Library/Android/sdk` };
execFileSync('npx', ['cap', 'sync', 'android'], { cwd: root, env, stdio: 'inherit' });
execFileSync('./gradlew', [bundle ? 'bundleRelease' : 'assembleRelease', '--quiet'], { cwd: android, env, stdio: 'inherit' });

const [built, out] = bundle
  ? ['bundle/release/app-release.aab', 'PhadeScores.aab']
  : ['apk/release/app-release.apk', 'PhadeScores.apk'];
mkdirSync(`${root}dist`, { recursive: true });
copyFileSync(`${android}/app/build/outputs/${built}`, `${root}dist/${out}`);
console.log(`Built dist/${out} (versionCode ${code})`);
