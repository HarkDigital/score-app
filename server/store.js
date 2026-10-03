// Everything the server remembers, in one JSON file: the lock-screen cards
// being kept current, the devices that want team alerts, the last state seen
// for each watched game (so alerts fire on a change, even across restarts),
// and the alerts already sent. Small enough to rewrite whole; writes are
// atomic (temp file + rename) and batched.

import fs from 'node:fs/promises';
import path from 'node:path';

const EMPTY = () => ({ activities: {}, devices: {}, games: {}, sent: {} });

export async function openStore(dir) {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'store.json');
  let data = EMPTY();
  try {
    data = { ...EMPTY(), ...JSON.parse(await fs.readFile(file, 'utf8')) };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  let timer = null;
  let writing = Promise.resolve();
  const write = () => {
    timer = null;
    writing = writing.then(async () => {
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data));
      await fs.rename(tmp, file);
    }).catch((err) => console.log(`store write failed: ${err.message}`));
    return writing;
  };

  return {
    data,
    // Batch a burst of changes into one write.
    save() {
      if (!timer) timer = setTimeout(write, 500);
    },
    async flush() {
      if (timer) clearTimeout(timer);
      await write();
    },
  };
}

const DAY = 86_400_000;

// Drop what can't matter any more. A Live Activity lives at most 8 hours
// (plus 4 on the lock screen); games and sent-alert marks after two days.
export function prune(data, now) {
  for (const [token, a] of Object.entries(data.activities)) if (now - a.createdAt > 12 * 3600_000) delete data.activities[token];
  for (const [key, g] of Object.entries(data.games)) if (now - g.at > 2 * DAY) delete data.games[key];
  for (const [key, at] of Object.entries(data.sent)) if (now - at > 2 * DAY) delete data.sent[key];
}
