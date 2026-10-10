'use strict';

const api = window.desktopApi;

const state = {
  items: [],
  outputDir: '',
  inputFile: '',
  activeTab: 'file',
  filter: 'all',
  sort: 'default'
};

// Surface renderer errors to the on-page log and the console (forwarded to the terminal).
window.addEventListener('error', (e) => {
  const msg = e.error ? e.error.stack || e.error.message : e.message;
  try {
    log(`[error] ${msg}`);
  } catch {
    /* log not ready */
  }
  console.error('Renderer error:', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  try {
    log(`[promise] ${r && r.stack ? r.stack : r}`);
  } catch {
    /* log not ready */
  }
  console.error('Unhandled rejection:', r);
});

// ---- helpers ----
const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
};

function log(msg) {
  const pre = $('#log');
  pre.textContent += `${msg}\n`;
  pre.scrollTop = pre.scrollHeight;
}

function fmtDuration(sec) {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

function fmtLongDuration(sec) {
  const total = Math.round(sec || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (h || m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

async function scanLibraryLength() {
  const dir = $('#outputDir').value.trim();
  if (!dir) {
    log('Set an output folder first.');
    return;
  }
  const btn = $('#scanLengthBtn');
  const out = $('#libraryStats');
  btn.disabled = true;
  out.textContent = 'Scanning folder…';
  try {
    const s = await api.libraryStats(dir);
    if (!s.count) {
      out.textContent = 'No audio files found in this folder.';
    } else {
      const missing = s.count - s.withDuration;
      out.textContent =
        `${s.count} song(s) · total length ${fmtLongDuration(s.totalSeconds)}` +
        (missing ? ` (${missing} without readable duration)` : '');
    }
  } catch (err) {
    out.textContent = `Could not scan: ${err.message || err}`;
  } finally {
    btn.disabled = false;
  }
}

// ---- setup / tool status ----
function renderToolPills(stateObj) {
  const yt = $('#ytdlpPill');
  yt.textContent = `yt-dlp: ${stateObj.ytdlpReady ? 'ready' : 'not set up'}`;
  yt.className = `pill ${stateObj.ytdlpReady ? 'pill-ok' : 'pill-warn'}`;
  const ff = $('#ffmpegPill');
  ff.textContent = `ffmpeg: ${stateObj.ffmpegReady ? 'ready' : 'missing'}`;
  ff.className = `pill ${stateObj.ffmpegReady ? 'pill-ok' : 'pill-warn'}`;
}

async function doSetup() {
  const btn = $('#setupBtn');
  btn.disabled = true;
  btn.textContent = 'Setting up…';
  log('Setting up tools…');
  const res = await api.ensureSetup();
  renderToolPills(res);
  if (res.error) log(`Setup finished with error: ${res.error}`);
  else log('Tools ready.');
  btn.disabled = false;
  btn.textContent = 'Set up tools';
}

// ---- analyze ----
async function doAnalyze() {
  const outputDir = $('#outputDir').value.trim();
  if (!outputDir) {
    log('Please choose an output folder first.');
    return;
  }
  state.outputDir = outputDir;

  const payload = { outputDir };
  if (state.activeTab === 'file') {
    if (!state.inputFile) {
      log('Please choose an input file.');
      return;
    }
    payload.filePath = state.inputFile;
  } else {
    const text = $('#inputText').value.trim();
    if (!text) {
      log('Please paste some songs or URLs.');
      return;
    }
    payload.text = text;
  }

  const progress = $('#analyzeProgress');
  progress.classList.remove('hidden');
  const bar = progress.querySelector('.bar');
  const label = progress.querySelector('.progress-label');
  bar.style.width = '0%';
  label.textContent = 'Analyzing…';
  $('#analyzeBtn').disabled = true;

  log('Analyzing input…');
  const res = await api.analyze(payload);

  $('#analyzeBtn').disabled = false;
  progress.classList.add('hidden');

  if (res.error) {
    log(`Analyze: ${res.error}`);
    return;
  }

  // Attach UI state to each item.
  state.items = res.items.map((it) => ({
    ...it,
    chosenIndex: it.chosen != null ? it.chosen : 0,
    selected: (it.status === 'exact' || it.status === 'direct') && !it.duplicate,
    dupAction: it.duplicate ? 'skip' : null
  }));
  log(`Analyzed ${state.items.length} songs. Library had ${res.libraryCount || 0} existing files.`);
  renderItems();
  persistState();
  refreshFolderStatus();
}

// Save the current queue to the output folder (fire-and-forget).
function persistState() {
  if (!state.outputDir || !state.items.length) return;
  api.saveState(state.outputDir, state.items).catch((err) => log(`[state] save failed: ${err.message || err}`));
}

// Check which songs already exist in the output folder and update their badges.
async function refreshFolderStatus() {
  if (!state.outputDir || !state.items.length) return;
  try {
    const payload = state.items.map((it) => ({
      id: it.id,
      artist: it.displayArtist || it.artist || '',
      title: it.displayTitle || it.title || '',
      url: currentUrl(it),
      downloadFile: it.download ? it.download.file : ''
    }));
    const results = await api.checkFolder(state.outputDir, payload);
    const byId = new Map(results.map((r) => [r.id, r]));
    for (const it of state.items) {
      const r = byId.get(it.id);
      it.exists = !!(r && r.exists);
      it.existingFile = r && r.file ? r.file : '';
    }
    renderItems();
  } catch (err) {
    log(`[folder] status check failed: ${err.message || err}`);
  }
}

// Load a previously saved queue for the current folder and show it.
async function loadSavedState(dir) {
  if (!dir) return;
  try {
    const data = await api.loadState(dir);
    if (data && Array.isArray(data.items) && data.items.length) {
      state.items = data.items;
      renderItems();
      const when = data.savedAt ? new Date(data.savedAt).toLocaleString() : 'unknown time';
      log(`Loaded saved state for this folder (${data.items.length} songs, saved ${when}).`);
      refreshFolderStatus();
    }
  } catch (err) {
    log(`[state] load failed: ${err.message || err}`);
  }
}

// ---- items rendering ----
function currentUrl(item) {
  const cand = item.candidates && item.candidates[item.chosenIndex];
  return cand ? cand.url : item.chosenUrl;
}
function currentScore(item) {
  const cand = item.candidates && item.candidates[item.chosenIndex];
  return cand && typeof cand.score === 'number' ? cand.score : item.bestScore;
}

function renderCounts() {
  const c = { exact: 0, uncertain: 0, direct: 0, notfound: 0, error: 0, dup: 0 };
  let inFolder = 0;
  for (const it of state.items) {
    c[it.status] = (c[it.status] || 0) + 1;
    if (it.duplicate) c.dup += 1;
    if (itemExists(it)) inFolder += 1;
  }
  $('#counts').innerHTML = '';
  const add = (label, n) =>
    $('#counts').appendChild(el('span', { textContent: `${label}: ${n}` }));
  add('Confident', c.exact + c.direct);
  add('Uncertain', c.uncertain);
  add('Not found', c.notfound);
  add('Errors', c.error);
  add('In folder', inFolder);
  add('Missing', state.items.length - inFolder);
}

function makeItemNode(item) {
  const node = el('div', { className: 'item' });
  node.dataset.id = item.id;

  // checkbox
  const check = el('input', { type: 'checkbox', className: 'item-check' });
  check.checked = !!item.selected;
  check.disabled = item.status === 'notfound' || item.status === 'error';
  check.addEventListener('change', () => {
    item.selected = check.checked;
  });

  // body
  const title = el('div', { className: 'item-title', textContent: item.displayTitle || item.query || '(unknown)' });
  const artist = el('div', {
    className: 'item-artist',
    textContent: item.displayArtist || ''
  });

  const meta = el('div', { className: 'item-meta' });
  const statusBadge = el('span', { className: `badge ${item.status}`, textContent: item.status });
  meta.appendChild(statusBadge);
  // Fresh folder-existence indicator.
  if (itemExists(item)) {
    meta.appendChild(el('span', { className: 'badge dup', textContent: 'in folder' }));
  } else {
    meta.appendChild(el('span', { className: 'badge missing', textContent: 'not in folder' }));
  }
  if (currentScore(item) != null && item.status !== 'direct') {
    meta.appendChild(
      el('span', { className: 'score', textContent: `match ${(currentScore(item) * 100).toFixed(0)}%` })
    );
  }

  // candidate selector (only when there are search candidates)
  if (item.candidates && item.candidates.length > 1) {
    const sel = el('select', { className: 'candidate-select' });
    item.candidates.forEach((cand, i) => {
      const opt = el('option', {
        value: String(i),
        textContent: `${(cand.score * 100).toFixed(0)}% · ${cand.title} · ${cand.channel || ''} ${
          cand.duration ? '(' + fmtDuration(cand.duration) + ')' : ''
        }`
      });
      sel.appendChild(opt);
    });
    sel.value = String(item.chosenIndex);
    sel.addEventListener('change', () => {
      item.chosenIndex = parseInt(sel.value, 10);
      // Refresh this item's meta badges/score.
      renderItems();
    });
    meta.appendChild(sel);
  }

  const body = el('div', { className: 'item-body' }, [title, artist, meta]);

  // duplicate choice row
  if (item.duplicate) {
    const dupRow = el('div', { className: 'dup-row' });
    dupRow.appendChild(
      el('span', { textContent: `Already in folder: ${item.duplicate.name}` })
    );
    const choice = el('div', { className: 'dup-choice' });
    ['skip', 'replace'].forEach((val) => {
      const id = `dup-${item.id}-${val}`;
      const radio = el('input', { type: 'radio', name: `dup-${item.id}`, id, value: val });
      radio.checked = item.dupAction === val;
      radio.addEventListener('change', () => {
        item.dupAction = val;
        if (val === 'replace') {
          item.selected = true;
          check.checked = true;
          check.disabled = false;
        } else {
          item.selected = false;
          check.checked = false;
        }
      });
      const lbl = el('label', { htmlFor: id }, [radio, ` ${val === 'skip' ? 'Skip' : 'Re-extract & replace'}`]);
      choice.appendChild(lbl);
    });
    dupRow.appendChild(choice);
    const openBtn = el('button', { className: 'btn btn-ghost btn-sm', textContent: 'Reveal' });
    openBtn.addEventListener('click', () => api.showItem(item.duplicate.file));
    dupRow.appendChild(openBtn);
    body.appendChild(dupRow);
  }

  // actions
  const actions = el('div', { className: 'item-actions' });
  const dlBtn = el('button', { className: 'btn btn-sm', textContent: 'Download' });
  dlBtn.disabled = item.status === 'notfound' || item.status === 'error';
  dlBtn.addEventListener('click', () => downloadItems([item]));
  const prog = el('div', { className: 'item-progress' }, [el('div', { className: 'bar' })]);
  const stateText = el('div', { className: 'state-text', textContent: '' });
  // Show a previously saved download outcome.
  if (item.download && item.download.status) {
    const d = item.download.status;
    stateText.textContent =
      d === 'downloaded' ? '✓ downloaded' : d === 'already' ? '✓ already had it' : d === 'error' ? `✗ ${item.download.message || 'error'}` : d;
    if ((d === 'downloaded' || d === 'already') && item.download.file) {
      dlBtn.textContent = 'Re-download';
      const reveal = el('button', { className: 'btn btn-ghost btn-sm', textContent: 'Reveal' });
      reveal.addEventListener('click', () => api.showItem(item.download.file));
      actions.appendChild(reveal);
    }
  }
  actions.appendChild(dlBtn);
  actions.appendChild(prog);
  actions.appendChild(stateText);

  const main = el('div', { className: 'item-main' }, [check, body, actions]);
  node.appendChild(main);
  return node;
}

function itemExists(item) {
  return !!(item.exists || (item.download && (item.download.status === 'downloaded' || item.download.status === 'already')));
}

function visibleItems() {
  let list = state.items.slice();
  if (state.filter === 'missing') list = list.filter((it) => !itemExists(it));
  else if (state.filter === 'exists') list = list.filter((it) => itemExists(it));

  const statusRank = { uncertain: 0, notfound: 1, error: 2, exact: 3, direct: 4 };
  if (state.sort === 'title') {
    list.sort((a, b) => (a.displayTitle || '').localeCompare(b.displayTitle || ''));
  } else if (state.sort === 'status') {
    list.sort((a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9));
  } else if (state.sort === 'exists') {
    // Missing first (actionable), then existing.
    list.sort((a, b) => Number(itemExists(a)) - Number(itemExists(b)));
  }
  return list;
}

function renderItems() {
  $('#resultsCard').classList.remove('hidden');
  renderCounts();
  const container = $('#items');
  container.innerHTML = '';
  const list = visibleItems();
  if (!list.length) {
    container.appendChild(el('p', { className: 'hint', textContent: 'No songs match the current filter.' }));
    return;
  }
  for (const item of list) container.appendChild(makeItemNode(item));
}

// ---- download ----
function buildDownloadPayloadItems(items) {
  return items
    .filter((it) => it.status !== 'notfound' && it.status !== 'error')
    .filter((it) => !(it.duplicate && it.dupAction === 'skip'))
    .map((it) => ({
      id: it.id,
      url: currentUrl(it),
      artist: it.displayArtist || it.artist || '',
      title: it.displayTitle || it.title || '',
      query: it.query || '',
      score: currentScore(it),
      replace: !!(it.duplicate && it.dupAction === 'replace'),
      duplicateFile: it.duplicate ? it.duplicate.file : ''
    }))
    .filter((it) => it.url);
}

function setItemProgress(id, progress, status, message) {
  const node = document.querySelector(`.item[data-id="${id}"]`);
  if (!node) return;
  const prog = node.querySelector('.item-progress');
  const bar = node.querySelector('.item-progress .bar');
  const text = node.querySelector('.state-text');
  if (prog) prog.style.display = 'block';
  if (bar && typeof progress === 'number') bar.style.width = `${Math.round(progress * 100)}%`;
  if (text) {
    if (status === 'downloaded') text.textContent = '✓ downloaded';
    else if (status === 'already') text.textContent = '✓ already had it';
    else if (status === 'error') text.textContent = `✗ ${message || 'error'}`;
    else text.textContent = `${Math.round((progress || 0) * 100)}%`;
  }
}

async function downloadItems(itemList) {
  if (!state.outputDir) {
    log('No output folder set.');
    return;
  }
  const payloadItems = buildDownloadPayloadItems(itemList);
  if (!payloadItems.length) {
    log('Nothing to download (check selections / duplicates).');
    return;
  }
  $('#downloadBtn').disabled = true;
  log(`Downloading ${payloadItems.length} song(s)…`);

  const res = await api.download({
    items: payloadItems,
    outputDir: state.outputDir,
    embed: $('#embedChk').checked
  });

  $('#downloadBtn').disabled = false;
  renderSummary(res);

  // Record outcomes onto the queue items and persist for next time.
  if (res && Array.isArray(res.results)) {
    const byId = new Map(res.results.map((r) => [r.id, r]));
    for (const it of state.items) {
      const r = byId.get(it.id);
      if (!r) continue;
      it.download = { status: r.status, file: r.file || '', message: r.message || '', at: new Date().toISOString() };
      if (r.status === 'downloaded' || r.status === 'already') it.selected = false;
    }
    persistState();
    refreshFolderStatus();
  }

  if (res.summary) {
    log(
      `Done. Downloaded ${res.summary.downloaded}, already had ${res.summary.already}, errors ${res.summary.errors}.`
    );
  }
}

function renderSummary(res) {
  if (!res || !res.summary) return;
  $('#summaryCard').classList.remove('hidden');
  const s = res.summary;
  const grid = el('div', { className: 'summary-grid' }, [
    el('div', { className: 'cell' }, [el('div', { className: 'num', textContent: String(s.total) }), 'total']),
    el('div', { className: 'cell' }, [
      el('div', { className: 'num', textContent: String(s.downloaded) }),
      'downloaded'
    ]),
    el('div', { className: 'cell' }, [el('div', { className: 'num', textContent: String(s.already) }), 'already']),
    el('div', { className: 'cell' }, [el('div', { className: 'num', textContent: String(s.errors) }), 'errors'])
  ]);
  const summary = $('#summary');
  summary.innerHTML = '';
  summary.appendChild(grid);
  if (res.resultFiles) {
    $('#openResultsBtn').onclick = () => api.openPath(res.resultFiles.csvPath);
  }
  $('#openFolderBtn').onclick = () => api.openPath(state.outputDir);
}

// ---- wiring ----
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $('#tab-file').classList.toggle('hidden', tab !== 'file');
  $('#tab-text').classList.toggle('hidden', tab !== 'text');
}

async function init() {
  if (!api) {
    const pre = $('#log');
    if (pre) pre.textContent = 'FATAL: preload bridge missing (window.desktopApi is undefined). Check preload.js / main.js webPreferences.';
    console.error('window.desktopApi is undefined — preload did not run.');
    return;
  }

  // Attach all UI events first so buttons work even if the initial state load fails.
  $('#setupBtn').addEventListener('click', doSetup);
  $('#analyzeBtn').addEventListener('click', doAnalyze);
  $('#downloadBtn').addEventListener('click', () =>
    downloadItems(state.items.filter((it) => it.selected))
  );

  $('#chooseInputBtn').addEventListener('click', async () => {
    const p = await api.openInput();
    if (p) {
      state.inputFile = p;
      $('#inputFile').value = p;
    }
  });
  $('#chooseOutputBtn').addEventListener('click', async () => {
    const p = await api.chooseOutput();
    if (p) {
      state.outputDir = p;
      $('#outputDir').value = p;
      loadSavedState(p);
    }
  });
  $('#openOutputBtn').addEventListener('click', () => api.openPath($('#outputDir').value.trim()));
  $('#scanLengthBtn').addEventListener('click', scanLibraryLength);
  $('#reloadStateBtn').addEventListener('click', () => loadSavedState($('#outputDir').value.trim()));
  $('#refreshStatusBtn').addEventListener('click', refreshFolderStatus);
  $('#filterSelect').addEventListener('change', (e) => {
    state.filter = e.target.value;
    renderItems();
  });
  $('#sortSelect').addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderItems();
  });

  $('#outputDir').addEventListener('change', (e) => {
    state.outputDir = e.target.value.trim();
    api.setSettings({ lastOutputDir: state.outputDir });
    loadSavedState(state.outputDir);
  });

  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => switchTab(t.dataset.tab))
  );

  $('#selectAllBtn').addEventListener('click', () => {
    state.items.forEach((it) => {
      if (it.status !== 'notfound' && it.status !== 'error') {
        if (!(it.duplicate && it.dupAction === 'skip')) it.selected = true;
      }
    });
    renderItems();
  });
  $('#selectConfidentBtn').addEventListener('click', () => {
    state.items.forEach((it) => {
      it.selected = (it.status === 'exact' || it.status === 'direct') && !it.duplicate;
    });
    renderItems();
  });
  $('#deselectAllBtn').addEventListener('click', () => {
    state.items.forEach((it) => {
      it.selected = false;
    });
    renderItems();
  });

  // live download progress
  api.on('download:progress', (d) => {
    setItemProgress(d.id, d.progress, d.status, d.message);
  });
  api.on('analyze:progress', (d) => {
    const progress = $('#analyzeProgress');
    const bar = progress.querySelector('.bar');
    const label = progress.querySelector('.progress-label');
    const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
    bar.style.width = `${pct}%`;
    label.textContent = `Analyzing ${d.done}/${d.total}…`;
  });
  api.on('setup:log', (msg) => log(msg));
  api.on('setup:progress', (d) => {
    if (d.progress != null) {
      $('#setupBtn').textContent = `${d.tool} ${Math.round(d.progress * 100)}%`;
    }
  });

  // Load initial state last; failure here must not disable the buttons above.
  try {
    const st = await api.getState();
    state.outputDir = st.defaultOutputDir;
    $('#outputDir').value = st.defaultOutputDir;
    if (st.lastInputFile) {
      state.inputFile = st.lastInputFile;
      $('#inputFile').value = st.lastInputFile;
    }
    renderToolPills(st);
    if (!st.ytdlpReady) {
      log('yt-dlp is not set up yet. Click "Set up tools" to download it (one-time).');
    }
    await loadSavedState(state.outputDir);
  } catch (err) {
    log(`[init] Could not load initial state: ${err.message || err}`);
  }
}

init().catch((err) => {
  try {
    log(`[init] ${err.stack || err.message}`);
  } catch {
    /* ignore */
  }
  console.error('init failed:', err);
});
