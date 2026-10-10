'use strict';

const { tokenSimilarity } = require('./text');

// Score threshold above which a match is considered confident ("exact").
const CONFIDENT_THRESHOLD = 0.72;

/**
 * Score a single candidate against a parsed entry.
 * Combines title/artist text similarity with an optional duration check.
 * Returns a number in [0,1].
 */
function scoreCandidate(entry, candidate) {
  const wanted = [entry.artist, entry.title].filter(Boolean).join(' ') || entry.title || entry.query;
  const haveText = [candidate.title, candidate.channel].filter(Boolean).join(' ');

  // Core text similarity (wanted vs candidate title).
  const titleSim = tokenSimilarity(wanted, candidate.title || '');
  // Give a small boost if the channel/uploader also matches the artist.
  const artistSim = entry.artist ? tokenSimilarity(entry.artist, haveText) : 0;

  let score = 0.8 * titleSim + 0.2 * artistSim;

  // Duration check, only when we know the expected duration.
  if (entry.duration != null && candidate.duration != null) {
    const diff = Math.abs(entry.duration - candidate.duration);
    if (diff <= 2) score += 0.08;
    else if (diff <= 5) score += 0.03;
    else if (diff > 20) score -= 0.15; // likely wrong track (edit/extended/live)
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Rank candidates for an entry. Mutates nothing; returns a sorted copy with scores,
 * plus the best score and a confidence flag.
 */
function rankCandidates(entry, candidates) {
  const scored = candidates
    .map((c) => ({ ...c, score: scoreCandidate(entry, c) }))
    .sort((a, b) => b.score - a.score);
  const best = scored.length ? scored[0].score : 0;
  return {
    candidates: scored,
    bestScore: best,
    confident: best >= CONFIDENT_THRESHOLD
  };
}

module.exports = { scoreCandidate, rankCandidates, CONFIDENT_THRESHOLD };
