'use strict';

const fs = require('fs');
const path = require('path');
const { run } = require('./ytdlp');

const PROGRESS_RE = /\[download\]\s+([\d.]+)%/;
const ALREADY_RE = /has already been downloaded/i;

/**
 * Download the audio for one analyzed item.
 * @param {object} item     analyzed item (must have chosenUrl)
 * @param {object} opts     { outputDir, ffmpegPath, embed, onProgress }
 * @returns {Promise<{ok:boolean, file?:string, message?:string, skipped?:boolean}>}
 */
async function downloadItem(item, opts) {
  const { outputDir, ffmpegPath, embed, onProgress } = opts;
  const url = item.chosenUrl;
  if (!url) return { ok: false, message: 'No URL to download.' };

  fs.mkdirSync(outputDir, { recursive: true });

  const template = path.join(outputDir, '%(title)s [%(id)s].%(ext)s');
  const args = [
    '--no-warnings',
    '--newline',
    '--no-playlist',
    '-f',
    'bestaudio/best',
    '-x',
    '--audio-format',
    'best',
    '-o',
    template,
    '--no-simulate',
    '--print',
    'after_move:filepath'
  ];

  if (ffmpegPath && path.isAbsolute(ffmpegPath)) {
    // ffmpeg is needed for -x extraction, not just embedding.
    args.push('--ffmpeg-location', ffmpegPath);
  }
  if (embed && ffmpegPath) {
    args.push('--embed-metadata', '--embed-thumbnail');
  }

  args.push(url);

  let finalFile = '';
  let already = false;

  const { code, stderr } = await run(args, {
    onLine: (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const m = trimmed.match(PROGRESS_RE);
      if (m) {
        if (onProgress) onProgress(parseFloat(m[1]) / 100);
        return;
      }
      if (ALREADY_RE.test(trimmed)) already = true;
      // A bare existing path printed by --print after_move:filepath is our result.
      if (!trimmed.startsWith('[') && fs.existsSync(trimmed)) {
        finalFile = trimmed;
      }
    }
  });

  if (code !== 0) {
    return { ok: false, message: stderr.trim().split('\n').pop() || `yt-dlp exited ${code}` };
  }

  if (onProgress) onProgress(1);
  return { ok: true, file: finalFile || null, already };
}

module.exports = { downloadItem };
