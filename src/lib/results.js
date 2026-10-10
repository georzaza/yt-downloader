'use strict';

const fs = require('fs');
const path = require('path');

const JSON_NAME = '_download-results.json';
const CSV_NAME = '_download-results.csv';

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Write results to both JSON and CSV in the output folder.
 * results: array of { artist, title, query, url, status, file, score, message }
 */
function writeResults(outputDir, results) {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, JSON_NAME);
  const csvPath = path.join(outputDir, CSV_NAME);

  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
    'utf8'
  );

  const header = ['status', 'artist', 'title', 'query', 'url', 'score', 'file', 'message'];
  const lines = [header.join(',')];
  for (const r of results) {
    lines.push(
      [
        r.status,
        r.artist,
        r.title,
        r.query,
        r.url,
        r.score != null ? r.score.toFixed(3) : '',
        r.file || '',
        r.message || ''
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');

  return { jsonPath, csvPath };
}

module.exports = { writeResults, JSON_NAME, CSV_NAME };
