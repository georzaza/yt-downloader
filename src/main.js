'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const binaries = require('./lib/binaries');
const parser = require('./lib/parser');
const { scanLibrary, libraryStats, findDuplicate } = require('./lib/library');
const { normalize, tokenSimilarity } = require('./lib/text');
const { analyzeEntries } = require('./lib/analyzer');
const { downloadItem } = require('./lib/downloader');
const { writeResults } = require('./lib/results');
const appstate = require('./lib/appstate');

let mainWindow = null;

// Log any uncaught main-process failures to the terminal.
process.on('uncaughtException', (err) => console.error('[main uncaught]', err));
process.on('unhandledRejection', (reason) => console.error('[main unhandledRejection]', reason));

// Runtime state for the tools.
const tools = {
  ytdlpReady: false,
  ffmpegPath: null,
  ffmpegReady: false
};

function defaultOutputDir() {
  return path.join(app.getPath('music') || app.getPath('downloads'), 'yt-music-downloader');
}

// App-level settings (remembers last-used paths) stored in Electron's userData dir.
function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {};
  } catch {
    return {};
  }
}
function saveSettings(patch) {
  const merged = { ...loadSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(merged, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
  return merged;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 820,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Forward renderer console + crashes to the terminal so errors are visible in `npm start`.
  const levels = ['LOG', 'WARN', 'ERROR', 'DEBUG'];
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${levels[level] || level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error(`[preload error] ${preloadPath}:`, error);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer gone]', details);
  });

  if (process.env.OPEN_DEVTOOLS !== '0') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC ----

ipcMain.handle('app:getState', () => {
  const settings = loadSettings();
  return {
    ytdlpReady: tools.ytdlpReady,
    ffmpegReady: tools.ffmpegReady,
    defaultOutputDir: settings.lastOutputDir || defaultOutputDir(),
    lastInputFile: settings.lastInputFile || ''
  };
});

ipcMain.handle('setup:ensure', async () => {
  const log = (msg) => send('setup:log', msg);
  try {
    await binaries.ensureYtDlp(log, (p) =>
      send('setup:progress', { tool: 'yt-dlp', progress: p })
    );
    tools.ytdlpReady = true;
    const ffmpeg = await binaries.ensureFfmpeg(log, (p) =>
      send('setup:progress', { tool: 'ffmpeg', progress: p })
    );
    tools.ffmpegPath = ffmpeg;
    tools.ffmpegReady = !!ffmpeg;
    return { ytdlpReady: tools.ytdlpReady, ffmpegReady: tools.ffmpegReady };
  } catch (err) {
    log(`Setup error: ${err.message}`);
    return { ytdlpReady: tools.ytdlpReady, ffmpegReady: tools.ffmpegReady, error: err.message };
  }
});

ipcMain.handle('library:stats', async (_evt, dir) => {
  return libraryStats(dir);
});

ipcMain.handle('state:load', async (_evt, dir) => {
  return appstate.loadState(dir);
});

ipcMain.handle('state:save', async (_evt, { dir, items }) => {
  return appstate.saveState(dir, items);
});

ipcMain.handle('settings:set', async (_evt, patch) => {
  return saveSettings(patch || {});
});

ipcMain.handle('folder:check', async (_evt, { dir, items }) => {
  const library = await scanLibrary(dir);

  // Index files by the YouTube id embedded in their name: "... [VIDEOID].ext".
  const idRe = /\[([A-Za-z0-9_-]{11})\]/;
  const idToFile = new Map();
  for (const rec of library.files) {
    const m = rec.name.match(idRe);
    if (m && !idToFile.has(m[1])) idToFile.set(m[1], rec.file);
  }

  const extractId = (url) => {
    if (!url) return '';
    const byParam = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (byParam) return byParam[1];
    const byShort = url.match(/(?:youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/);
    if (byShort) return byShort[1];
    const bare = url.match(/\b([A-Za-z0-9_-]{11})\b/);
    return bare ? bare[1] : '';
  };

  // Precompute normalized token strings for fuzzy fallback (tags, else filename).
  const libNorm = library.files.map((rec) => ({
    file: rec.file,
    text: normalize(`${rec.artist || ''} ${rec.title || ''} ${rec.name || ''}`)
  }));

  const fuzzyMatch = (artist, title) => {
    const want = `${artist || ''} ${title || ''}`.trim();
    if (!want) return '';
    let best = '';
    let bestScore = 0;
    for (const rec of libNorm) {
      const score = tokenSimilarity(want, rec.text);
      if (score > bestScore) {
        bestScore = score;
        best = rec.file;
      }
    }
    return bestScore >= 0.6 ? best : '';
  };

  return (items || []).map((it) => {
    // 1) a previously recorded downloaded file
    let file = it.downloadFile && fs.existsSync(it.downloadFile) ? it.downloadFile : '';
    // 2) the exact YouTube id present in a filename (most reliable)
    if (!file && it.url) {
      const vid = extractId(it.url);
      if (vid && idToFile.has(vid)) file = idToFile.get(vid);
    }
    // 3) exact embedded-metadata match
    if (!file) {
      const dup = findDuplicate(library, it.artist, it.title);
      if (dup) file = dup.file;
    }
    // 4) fuzzy match against tags/filename
    if (!file) file = fuzzyMatch(it.artist, it.title);
    return { id: it.id, exists: !!file, file };
  });
});

ipcMain.handle('dialog:openInput', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a song list',
    properties: ['openFile'],
    filters: [
      { name: 'Song lists', extensions: ['txt', 'csv'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (res.canceled || !res.filePaths.length) return null;
  saveSettings({ lastInputFile: res.filePaths[0] });
  return res.filePaths[0];
});

ipcMain.handle('dialog:chooseOutput', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose output folder',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths.length) return null;
  saveSettings({ lastOutputDir: res.filePaths[0] });
  return res.filePaths[0];
});

ipcMain.handle('analyze', async (_evt, payload) => {
  const { filePath, text, outputDir } = payload;
  if (outputDir) saveSettings({ lastOutputDir: outputDir });
  if (filePath) saveSettings({ lastInputFile: filePath });
  let entries = [];
  if (filePath) entries = parser.parseFile(filePath);
  else if (text) entries = parser.parseText(text);

  if (!entries.length) return { items: [], error: 'No songs found in the input.' };

  const library = await scanLibrary(outputDir);

  const items = await analyzeEntries(entries, library, {
    concurrency: 4,
    searchLimit: 5,
    onProgress: (p) => send('analyze:progress', { done: p.done, total: p.total })
  });

  return { items, libraryCount: library.files.length };
});

ipcMain.handle('download', async (_evt, payload) => {
  const { items, outputDir, embed } = payload;

  // Audio extraction (-x) requires ffmpeg/ffprobe; set them up now if missing.
  if (!tools.ffmpegReady) {
    const ffmpeg = await binaries.ensureFfmpeg(
      (msg) => send('setup:log', msg),
      (p) => send('setup:progress', { tool: 'ffmpeg', progress: p })
    );
    tools.ffmpegPath = ffmpeg;
    tools.ffmpegReady = !!ffmpeg;
    if (!ffmpeg) {
      send('setup:log', 'ffmpeg is unavailable; cannot extract audio. Click "Set up tools" or install ffmpeg.');
    }
  }

  const useEmbed = embed !== false && tools.ffmpegReady;
  const results = [];

  for (const item of items) {
    send('download:progress', { id: item.id, status: 'downloading', progress: 0 });

    // Handle replace: remove the existing duplicate first.
    if (item.replace && item.duplicateFile) {
      try {
        if (fs.existsSync(item.duplicateFile)) fs.rmSync(item.duplicateFile, { force: true });
      } catch {
        /* ignore */
      }
    }

    let result;
    try {
      result = await downloadItem(
        { chosenUrl: item.url },
        {
          outputDir,
          ffmpegPath: tools.ffmpegPath,
          embed: useEmbed,
          onProgress: (p) => send('download:progress', { id: item.id, status: 'downloading', progress: p })
        }
      );
    } catch (err) {
      result = { ok: false, message: err.message };
    }

    const record = {
      id: item.id,
      artist: item.artist || '',
      title: item.title || '',
      query: item.query || '',
      url: item.url,
      score: typeof item.score === 'number' ? item.score : null,
      status: result.ok ? (result.already ? 'already' : 'downloaded') : 'error',
      file: result.file || '',
      message: result.message || ''
    };
    results.push(record);
    send('download:progress', {
      id: item.id,
      status: record.status,
      progress: 1,
      file: record.file,
      message: record.message
    });
  }

  let resultFiles = null;
  try {
    resultFiles = writeResults(outputDir, results);
  } catch (err) {
    send('setup:log', `Could not write results file: ${err.message}`);
  }

  const summary = {
    total: results.length,
    downloaded: results.filter((r) => r.status === 'downloaded').length,
    already: results.filter((r) => r.status === 'already').length,
    errors: results.filter((r) => r.status === 'error').length
  };
  return { results, summary, resultFiles };
});

ipcMain.handle('shell:openPath', async (_evt, p) => {
  if (p) await shell.openPath(p);
});

ipcMain.handle('shell:showItem', async (_evt, p) => {
  if (p && fs.existsSync(p)) shell.showItemInFolder(p);
});
