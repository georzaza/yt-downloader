'use strict';

// Noise words commonly found in YouTube titles that we strip when comparing.
const NOISE = [
  'official video',
  'official music video',
  'official audio',
  'official lyric video',
  'lyric video',
  'lyrics',
  'audio',
  'visualizer',
  'hd',
  '4k',
  'mv',
  'm/v',
  'remastered',
  'official'
];

function stripNoise(str) {
  let s = ` ${str} `;
  for (const n of NOISE) {
    s = s.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
  }
  return s;
}

/**
 * Normalize a string for comparison: lowercase, remove bracketed noise,
 * strip punctuation, collapse whitespace.
 */
function normalize(str) {
  if (!str) return '';
  let s = String(str).toLowerCase();
  // Remove content in (), [], {} that is noise (feat. kept separately below).
  s = stripNoise(s);
  s = s.replace(/[\(\)\[\]\{\}]/g, ' ');
  // Replace feat/ft markers.
  s = s.replace(/\b(feat|ft|featuring)\b\.?/g, ' ');
  // Remove accents.
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Keep alphanumerics and spaces.
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function tokens(str) {
  const n = normalize(str);
  if (!n) return [];
  return n.split(' ').filter(Boolean);
}

/**
 * Token-set similarity in [0,1]: size of intersection over size of the smaller set,
 * blended with Jaccard so that extra tokens on one side are penalized mildly.
 */
function tokenSimilarity(a, b) {
  const setA = new Set(tokens(a));
  const setB = new Set(tokens(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter += 1;
  const union = new Set([...setA, ...setB]).size;
  const jaccard = inter / union;
  const coverage = inter / Math.min(setA.size, setB.size);
  return 0.5 * jaccard + 0.5 * coverage;
}

module.exports = { normalize, tokens, tokenSimilarity };
