// Builds the Android app as a signed APK to hand to testers:
//   npm run android:apk
// Raises the versionCode first (Android won't install an older one over a
// newer one), syncs the Capacitor config, builds with Gradle on Java 21
// (Homebrew's openjdk@21; Android Studio's own Java is too new for this
// Gradle), and copies the result to dist/PhadeScores.apk (not in git).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

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
execFileSync('./gradlew', ['assembleRelease', '--quiet'], { cwd: android, env, stdio: 'inherit' });

mkdirSync(`${root}dist`, { recursive: true });
copyFileSync(`${android}/app/build/outputs/apk/release/app-release.apk`, `${root}dist/PhadeScores.apk`);
console.log(`Built dist/PhadeScores.apk (versionCode ${code})`);
