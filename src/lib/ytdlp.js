'use strict';

const { spawn } = require('child_process');
const { ytdlpPath } = require('./binaries');

/**
 * Run yt-dlp with the given args.
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
function run(args, { onLine, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytdlpPath(), args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let outBuf = '';

    child.stdout.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      if (onLine) {
        outBuf += text;
        let idx;
        while ((idx = outBuf.indexOf('\n')) >= 0) {
          const line = outBuf.slice(0, idx);
          outBuf = outBuf.slice(idx + 1);
          onLine(line);
        }
      }
    });
    child.stderr.on('data', (d) => {
      const text = d.toString();
      stderr += text;
      if (onStderr) onStderr(text);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (onLine && outBuf) onLine(outBuf);
      resolve({ code, stdout, stderr });
    });
  });
}

function toWatchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * Search YouTube for candidates. Returns an array of
 * { id, url, title, channel, duration, viewCount }.
 */
async function searchCandidates(query, limit = 5) {
  const { code, stdout, stderr } = await run([
    '--no-warnings',
    '--flat-playlist',
    '-J',
    `ytsearch${limit}:${query}`
  ]);
  if (code !== 0) {
    throw new Error(stderr.trim() || `yt-dlp search failed (code ${code})`);
  }
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return [];
  }
  const entries = Array.isArray(data.entries) ? data.entries : [];
  return entries
    .filter((e) => e && e.id)
    .map((e) => ({
      id: e.id,
      url: e.url && /^https?:/.test(e.url) ? e.url : toWatchUrl(e.id),
      title: e.title || '',
      channel: e.channel || e.uploader || e.playlist_uploader || '',
      duration: typeof e.duration === 'number' ? e.duration : null,
      viewCount: typeof e.view_count === 'number' ? e.view_count : null
    }));
}

/**
 * Fetch metadata for a single URL (first video only). Returns a normalized info object or null.
 */
async function fetchInfo(url) {
  const { code, stdout } = await run([
    '--no-warnings',
    '--no-playlist',
    '--flat-playlist',
    '-J',
    url
  ]);
  if (code !== 0) return null;
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return null;
  }
  const info = data.entries && data.entries.length ? data.entries[0] : data;
  if (!info || !info.id) return null;
  return {
    id: info.id,
    url: info.webpage_url || info.url || toWatchUrl(info.id),
    title: info.title || '',
    channel: info.channel || info.uploader || '',
    artist: info.artist || info.creator || '',
    track: info.track || '',
    duration: typeof info.duration === 'number' ? info.duration : null
  };
}

module.exports = { run, searchCandidates, fetchInfo, toWatchUrl };
