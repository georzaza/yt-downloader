'use strict';

// Standalone helper: `npm run setup` downloads yt-dlp (+ ffmpeg on Windows)
// into ./bin without launching the UI.
const { ensureYtDlp, ensureFfmpeg } = require('../src/lib/binaries');

(async () => {
  const log = (m) => console.log(m);
  try {
    await ensureYtDlp(log, (p) => p != null && process.stdout.write(`\ryt-dlp ${Math.round(p * 100)}%   `));
    process.stdout.write('\n');
    await ensureFfmpeg(log, (p) => p != null && process.stdout.write(`\rffmpeg ${Math.round(p * 100)}%   `));
    process.stdout.write('\n');
    console.log('Setup complete.');
  } catch (err) {
    console.error('Setup failed:', err.message);
    process.exit(1);
  }
})();
