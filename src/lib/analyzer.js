'use strict';

const { searchCandidates, fetchInfo } = require('./ytdlp');
const { rankCandidates } = require('./matcher');
const { findDuplicate } = require('./library');

/** Run async tasks with limited concurrency. */
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Analyze one parsed entry: resolve a URL (direct or via search), score it,
 * and check the library for duplicates.
 */
async function analyzeEntry(entry, library, searchLimit) {
  const item = {
    ...entry,
    status: 'pending',
    candidates: [],
    chosen: null,
    chosenUrl: '',
    bestScore: 0,
    duplicate: null,
    displayTitle: entry.title || entry.query || entry.url,
    displayArtist: entry.artist || '',
    error: ''
  };

  try {
    if (entry.url) {
      // Direct URL: trust it, but fetch light metadata for display + dedup.
      item.status = 'direct';
      item.chosenUrl = entry.url;
      item.bestScore = 1;
      const info = await fetchInfo(entry.url).catch(() => null);
      if (info) {
        item.displayTitle = entry.title || info.track || info.title || entry.url;
        item.displayArtist = entry.artist || info.artist || info.channel || '';
        item.candidates = [
          {
            id: info.id,
            url: info.url,
            title: info.title,
            channel: info.channel,
            duration: info.duration,
            score: 1
          }
        ];
        item.chosen = 0;
      }
    } else if (entry.query) {
      // Search + score.
      const candidates = await searchCandidates(entry.query, searchLimit);
      if (!candidates.length) {
        item.status = 'notfound';
      } else {
        const ranked = rankCandidates(entry, candidates);
        item.candidates = ranked.candidates;
        item.bestScore = ranked.bestScore;
        item.chosen = 0;
        item.chosenUrl = ranked.candidates[0].url;
        item.status = ranked.confident ? 'exact' : 'uncertain';
      }
    } else {
      item.status = 'error';
      item.error = 'No URL or searchable title/artist.';
    }

    // Duplicate check against the output folder's embedded metadata.
    const dupArtist = item.displayArtist || entry.artist;
    const dupTitle = item.displayTitle || entry.title;
    const dup = findDuplicate(library, dupArtist, dupTitle);
    if (dup) item.duplicate = { file: dup.file, name: dup.name, artist: dup.artist, title: dup.title };
  } catch (err) {
    item.status = 'error';
    item.error = err.message || String(err);
  }

  return item;
}

/**
 * Analyze all entries. Calls onProgress({ done, total, item }) as each completes.
 */
async function analyzeEntries(entries, library, { concurrency = 4, searchLimit = 5, onProgress } = {}) {
  let done = 0;
  const total = entries.length;
  return runPool(entries, concurrency, async (entry) => {
    const item = await analyzeEntry(entry, library, searchLimit);
    done += 1;
    if (onProgress) onProgress({ done, total, item });
    return item;
  });
}

module.exports = { analyzeEntries, analyzeEntry, runPool };
