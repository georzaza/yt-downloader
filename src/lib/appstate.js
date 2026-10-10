'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILE = '_yt-music-state.json';
const VERSION = 1;

function stateFilePath(dir) {
  return path.join(dir, STATE_FILE);
}

/** Load saved queue/state for a folder. Returns { version, savedAt, items } or null. */
function loadState(dir) {
  if (!dir) return null;
  const file = stateFilePath(dir);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || !Array.isArray(data.items)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Persist the analyzed queue (plain item objects) to the folder. */
function saveState(dir, items) {
  if (!dir) return false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const payload = { version: VERSION, savedAt: new Date().toISOString(), items: items || [] };
    fs.writeFileSync(stateFilePath(dir), JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

module.exports = { loadState, saveState, STATE_FILE };
