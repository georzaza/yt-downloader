'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

// Where downloaded tools live.
const BIN_DIR = path.join(__dirname, '..', '..', 'bin');

const YTDLP_URLS = {
  win32: 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe',
  darwin: 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_macos',
  linux: 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp'
};

const YTDLP_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';

function ytdlpPath() {
  return path.join(BIN_DIR, YTDLP_NAME);
}

function ensureBinDir() {
  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });
}

/**
 * Download a URL to a file, following redirects. Reports progress via onProgress(0..1|null).
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const tmp = destPath + '.part';
    const file = fs.createWriteStream(tmp);

    const request = (currentUrl, redirects) => {
      if (redirects > 10) {
        file.close();
        return reject(new Error('Too many redirects'));
      }
      https
        .get(currentUrl, { headers: { 'User-Agent': 'yt-music-downloader' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return request(new URL(res.headers.location, currentUrl).toString(), redirects + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            file.close();
            return reject(new Error(`Download failed (${res.statusCode}) for ${currentUrl}`));
          }
          const total = parseInt(res.headers['content-length'] || '0', 10);
          let received = 0;
          res.on('data', (chunk) => {
            received += chunk.length;
            if (onProgress) onProgress(total ? received / total : null);
          });
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
        })
        .on('error', (err) => {
          file.close();
          fs.rm(tmp, { force: true }, () => reject(err));
        });
    };

    file.on('error', (err) => {
      fs.rm(tmp, { force: true }, () => reject(err));
    });

    request(url, 0);
  }).then(() => {
    const tmp = destPath + '.part';
    fs.renameSync(tmp, destPath);
  });
}

/**
 * Ensure yt-dlp nightly is available. Returns the path to the binary.
 */
async function ensureYtDlp(log = () => {}, onProgress) {
  ensureBinDir();
  const dest = ytdlpPath();
  if (fs.existsSync(dest)) {
    log(`yt-dlp present: ${dest}`);
    return dest;
  }
  const url = YTDLP_URLS[process.platform];
  if (!url) throw new Error(`Unsupported platform: ${process.platform}`);
  log('Downloading yt-dlp (nightly)...');
  await downloadFile(url, dest, onProgress);
  if (process.platform !== 'win32') {
    fs.chmodSync(dest, 0o755);
  }
  log('yt-dlp downloaded.');
  return dest;
}

/**
 * Filenames for the ffmpeg/ffprobe pair on the current platform.
 */
function ffmpegFileNames() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return { ffmpeg: `ffmpeg${ext}`, ffprobe: `ffprobe${ext}` };
}

function localFfmpegPaths() {
  const names = ffmpegFileNames();
  return {
    ffmpeg: path.join(BIN_DIR, names.ffmpeg),
    ffprobe: path.join(BIN_DIR, names.ffprobe)
  };
}

function isRunnable(binPath) {
  const probe = spawnSync(binPath, ['-version'], { stdio: 'ignore' });
  return !probe.error && probe.status === 0;
}

/**
 * Locate a USABLE ffmpeg: both ffmpeg and ffprobe must be present (yt-dlp needs both).
 * Prefers our bundled bin/, then PATH. Returns the ffmpeg path/command, or null.
 */
function findFfmpeg() {
  const names = ffmpegFileNames();
  const local = localFfmpegPaths();
  if (fs.existsSync(local.ffmpeg) && fs.existsSync(local.ffprobe) && isRunnable(local.ffmpeg)) {
    return local.ffmpeg;
  }
  // PATH: only trust it when BOTH binaries resolve.
  if (isRunnable(names.ffmpeg) && isRunnable(names.ffprobe)) {
    return names.ffmpeg;
  }
  return null;
}

/**
 * Ensure a usable ffmpeg + ffprobe pair. On Windows, auto-downloads a static build
 * into bin/ when missing. Returns the ffmpeg path/command, or null if unavailable.
 */
async function ensureFfmpeg(log = () => {}, onProgress) {
  ensureBinDir();

  const existing = findFfmpeg();
  if (existing) {
    log(`ffmpeg + ffprobe present: ${existing}`);
    return existing;
  }

  if (process.platform !== 'win32') {
    log(
      'ffmpeg/ffprobe not found. Install ffmpeg (e.g. "brew install ffmpeg" or "apt install ffmpeg") to enable extraction & embedding.'
    );
    return null;
  }

  // Windows: download a static build that contains both ffmpeg.exe and ffprobe.exe.
  const zipPath = path.join(BIN_DIR, 'ffmpeg.zip');
  const extractDir = path.join(BIN_DIR, 'ffmpeg-extract');
  try {
    const zipUrl =
      'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
    log('Downloading ffmpeg (static win64 build, ~80 MB)...');
    await downloadFile(zipUrl, zipPath, onProgress);

    fs.rmSync(extractDir, { recursive: true, force: true });
    log('Extracting ffmpeg + ffprobe...');
    const res = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${extractDir}" -Force`
      ],
      { stdio: 'ignore' }
    );
    if (res.status !== 0) throw new Error(`Expand-Archive failed (status ${res.status})`);

    const dest = localFfmpegPaths();
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
      const found = findFileRecursive(extractDir, name);
      if (!found) throw new Error(`${name} not found in the downloaded build`);
      fs.copyFileSync(found, path.join(BIN_DIR, name));
    }

    if (!isRunnable(dest.ffmpeg) || !isRunnable(dest.ffprobe)) {
      throw new Error('downloaded ffmpeg/ffprobe did not run');
    }

    log('ffmpeg + ffprobe ready.');
    return dest.ffmpeg;
  } catch (err) {
    log(`Could not set up ffmpeg automatically: ${err.message}`);
    return null;
  } finally {
    fs.rmSync(zipPath, { force: true });
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

function findFileRecursive(dir, name) {
  let stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === name.toLowerCase()) return full;
    }
  }
  return null;
}

module.exports = {
  BIN_DIR,
  ytdlpPath,
  ensureYtDlp,
  ensureFfmpeg,
  findFfmpeg,
  downloadFile
};
