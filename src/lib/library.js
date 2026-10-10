'use strict';

const fs = require('fs');
const path = require('path');
const { normalize } = require('./text');

const AUDIO_EXTS = new Set(['.m4a', '.mp3', '.opus', '.ogg', '.oga', '.webm', '.flac', '.aac', '.wav', '.mp4']);

// music-metadata is ESM-only; load it lazily from CommonJS.
let _mmPromise = null;
function loadMusicMetadata() {
  if (!_mmPromise) _mmPromise = import('music-metadata');
  return _mmPromise;
}

function keyOf(artist, title) {
  const a = normalize(artist);
  const t = normalize(title);
  if (!t && !a) return '';
  return `${a}|${t}`;
}

function titleKeyOf(title) {
  return normalize(title);
}

/**
 * Scan a folder for audio files and read embedded artist/title tags.
 * Returns { byKey: Map, byTitle: Map, files: [...] }.
 */
async function scanLibrary(dir) {
  const byKey = new Map();
  const byTitle = new Map();
  const files = [];
  if (!dir || !fs.existsSync(dir)) return { byKey, byTitle, files };

  const mm = await loadMusicMetadata();
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { byKey, byTitle, files };
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!AUDIO_EXTS.has(ext)) continue;
    const full = path.join(dir, entry.name);
    let artist = '';
    let title = '';
    try {
      const meta = await mm.parseFile(full, { duration: false });
      artist = (meta.common.artist || '').trim();
      title = (meta.common.title || '').trim();
    } catch {
      // Unreadable tags; fall back to filename.
    }
    if (!title) title = path.basename(entry.name, ext);
    const record = { file: full, name: entry.name, artist, title };
    files.push(record);
    const k = keyOf(artist, title);
    if (k) byKey.set(k, record);
    const tk = titleKeyOf(title);
    if (tk) byTitle.set(tk, record);
  }
  return { byKey, byTitle, files };
}

/**
 * Check whether an entry (artist/title) already exists in the scanned library.
 * Returns the matching record or null.
 */
function findDuplicate(library, artist, title) {
  if (!library) return null;
  const k = keyOf(artist, title);
  if (k && library.byKey.has(k)) return library.byKey.get(k);
  const tk = titleKeyOf(title);
  if (tk && library.byTitle.has(tk)) return library.byTitle.get(tk);
  return null;
}

/**
 * Sum the durations of all audio files in a folder.
 * Returns { count, withDuration, totalSeconds }.
 */
async function libraryStats(dir) {
  const stats = { count: 0, withDuration: 0, totalSeconds: 0 };
  if (!dir || !fs.existsSync(dir)) return stats;

  const mm = await loadMusicMetadata();
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return stats;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!AUDIO_EXTS.has(ext)) continue;
    stats.count += 1;
    try {
      const meta = await mm.parseFile(path.join(dir, entry.name));
      const d = meta.format && meta.format.duration;
      if (typeof d === 'number' && isFinite(d) && d > 0) {
        stats.totalSeconds += d;
        stats.withDuration += 1;
      }
    } catch {
      // Unreadable file; counted but no duration.
    }
  }
  return stats;
}

module.exports = { scanLibrary, findDuplicate, libraryStats, keyOf, AUDIO_EXTS };

