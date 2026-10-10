'use strict';

const fs = require('fs');
const path = require('path');

const URL_RE = /^https?:\/\/\S+$/i;
const ANY_URL_RE = /https?:\/\/\S+/i;

let _idCounter = 0;
function nextId() {
  _idCounter += 1;
  return `s${_idCounter}`;
}

function makeEntry(fields) {
  const artist = (fields.artist || '').trim();
  const title = (fields.title || '').trim();
  const query = [artist, title].filter(Boolean).join(' ').trim();
  return {
    id: nextId(),
    source: fields.source || 'unknown',
    raw: fields.raw || '',
    artist,
    title,
    url: (fields.url || '').trim(),
    duration: fields.duration != null ? fields.duration : null,
    trackId: (fields.trackId || '').trim(),
    query
  };
}

/** Parse "1:23" or "83" or "83s" into seconds. Returns null if not parseable. */
function parseDuration(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const parts = s.split(':').map((p) => p.trim());
  if (parts.every((p) => /^\d+$/.test(p)) && parts.length >= 2 && parts.length <= 3) {
    return parts.reduce((acc, p) => acc * 60 + parseInt(p, 10), 0);
  }
  const m = s.match(/^(\d+(?:\.\d+)?)\s*s$/i);
  if (m) return Math.round(parseFloat(m[1]));
  return null;
}

/** Minimal RFC-4180-ish CSV parser. Returns array of string arrays. */
function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // ignore; handled by \n
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length && r.some((v) => v && v.trim() !== ''));
}

const COLUMN_ALIASES = {
  title: ['title', 'track', 'song', 'name', 'track name', 'track_name'],
  artist: ['artist', 'artists', 'artist name', 'artist_name', 'performer'],
  url: ['url', 'link', 'youtube', 'youtube url', 'youtube_url', 'video url'],
  trackId: ['shazam_track_id', 'track_id', 'trackid', 'id', 'shazamid', 'shazam id'],
  duration: ['duration', 'length', 'time', 'duration_s', 'seconds']
};

function resolveHeader(header) {
  const map = {};
  header.forEach((raw, idx) => {
    const key = raw.trim().toLowerCase();
    for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(key)) {
        if (map[canonical] == null) map[canonical] = idx;
      }
    }
  });
  return map;
}

function parseCsv(text) {
  const rows = parseCsvText(text);
  if (!rows.length) return [];
  const header = rows[0];
  const map = resolveHeader(header);
  const hasHeader = Object.keys(map).length > 0;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  // If no recognizable header, assume [artist, title, url?] column order.
  const fallback = { artist: 0, title: 1, url: 2 };
  const cols = hasHeader ? map : fallback;

  return dataRows.map((r) => {
    const get = (k) => (cols[k] != null ? (r[cols[k]] || '').trim() : '');
    let url = get('url');
    if (url && !ANY_URL_RE.test(url)) url = '';
    return makeEntry({
      source: 'csv',
      raw: r.join(','),
      artist: get('artist'),
      title: get('title'),
      url,
      trackId: get('trackId'),
      duration: parseDuration(get('duration'))
    });
  });
}

/** Parse one TXT line like "Artist - Title" or "Artist - Title - https://..." */
function parseTxtLine(line) {
  const raw = line.trim();
  if (!raw || raw.startsWith('#')) return null;

  // Whole line is a URL.
  if (URL_RE.test(raw)) {
    return makeEntry({ source: 'txt', raw, url: raw });
  }

  // Extract a trailing/standalone URL if present.
  let url = '';
  let working = raw;
  const urlMatch = raw.match(ANY_URL_RE);
  if (urlMatch) {
    url = urlMatch[0];
    working = raw.replace(url, '').replace(/\s*-\s*$/, '').trim();
  }

  const parts = working.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return url ? makeEntry({ source: 'txt', raw, url }) : null;
  }
  if (parts.length === 1) {
    // Only a title/search term.
    return makeEntry({ source: 'txt', raw, title: parts[0], url });
  }
  const artist = parts[0];
  const title = parts.slice(1).join(' - ');
  return makeEntry({ source: 'txt', raw, artist, title, url });
}

function parseTxt(text) {
  return text
    .split(/\r?\n/)
    .map(parseTxtLine)
    .filter(Boolean);
}

/** Parse free-form text pasted in the UI (URLs or "Artist - Title" lines). */
function parseText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  // If it looks like CSV (has commas + a header), treat as CSV.
  const firstLine = trimmed.split(/\r?\n/)[0].toLowerCase();
  const looksCsv =
    firstLine.includes(',') &&
    Object.values(COLUMN_ALIASES).some((aliases) => aliases.some((a) => firstLine.includes(a)));
  if (looksCsv) return parseCsv(trimmed);
  return parseTxt(trimmed);
}

function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const text = fs.readFileSync(filePath, 'utf8');
  if (ext === '.csv') return parseCsv(text);
  return parseTxt(text);
}

module.exports = {
  parseFile,
  parseText,
  parseCsv,
  parseTxt,
  parseDuration,
  makeEntry
};
