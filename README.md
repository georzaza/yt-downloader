# YT Music Downloader

A small cross‑platform **Electron** desktop app that turns a list of songs into downloaded
audio using **[yt-dlp](https://github.com/yt-dlp/yt-dlp) (nightly)**. Feed it a direct URL, a
`.txt` list, or a `.csv` export (e.g. from Shazam). When a song has no URL, the app searches
YouTube, scores how confident the match is, flags the uncertain ones for review, tells you which
songs you already have in the folder, downloads the best available audio, and remembers its state
so you can pick up where you left off.

> Download only content you have the right to download. See [Legal](#legal).

---

## Highlights

- **Flexible input** — a single URL, a `.txt` list, a `.csv` export, or text pasted into the app.
- **Smart matching** — searches YouTube and ranks results by `artist + title` similarity (plus
  duration when known), labelling each match **confident** or **uncertain**.
- **Review before download** — confident matches are preselected; for uncertain ones you can pick
  a different candidate from a dropdown or download them individually.
- **Knows what you already have** — flags every song as **in folder** / **not in folder** using the
  embedded YouTube id in filenames, embedded tags, and fuzzy title matching. Filter and sort by it.
- **Duplicate handling** — choose **Skip** or **Re‑extract & replace** per existing song.
- **Best audio, no re‑encode** — `-x --audio-format best`, with metadata + cover art embedded when
  ffmpeg is available.
- **Persistent state** — the analyzed queue and download results are saved in the output folder
  (`_yt-music-state.json`) and reloaded automatically; the last folder and input file are remembered.
- **Library tools** — one‑click total playtime of everything in the output folder.
- **Zero manual setup** — downloads `yt-dlp` nightly (and ffmpeg on Windows) into `./bin` on first run.

---

## Requirements

- **Node.js 18+**
- An internet connection (the first run downloads the tools)
- **ffmpeg** — auto‑downloaded on Windows. On macOS/Linux install it to enable audio extraction and
  tag/cover embedding:
  - macOS: `brew install ffmpeg`
  - Debian/Ubuntu: `sudo apt install ffmpeg`

---

## Getting started

```powershell
npm install
npm start
```

Then, in the app:

1. Click **Set up tools** (one‑time; downloads yt-dlp and ffmpeg into `./bin`).
2. Pick an **output folder**.
3. Choose a **file** (`.txt` / `.csv`) or switch to **Paste / URL** and paste URLs or
   `Artist - Title` lines.
4. Click **Analyze**, review the matches, resolve any duplicates, then **Download selected**.

Prefer the command line for the one‑time tool download?

```powershell
npm run setup
```

---

## Input formats

**TXT** — one song per line:

```
Artist - Title
Artist - Title - https://www.youtube.com/watch?v=...
https://www.youtube.com/watch?v=...
```

**CSV** — a header row with any of these columns (case‑insensitive):

| Column            | Purpose                                       |
| ----------------- | --------------------------------------------- |
| `title`           | Song title (used for search)                  |
| `artist`          | Artist (used for search)                      |
| `url`             | If present, downloaded directly (no search)   |
| `shazam_track_id` | Carried through to the results file           |
| `duration`        | `mm:ss` or seconds; improves match confidence |

If a `url` is present it is used directly; otherwise the app searches YouTube using `artist + title`.
Sample files live in [`examples/`](examples).

> **Tip:** the companion project
> **[live-radio-song-logger](https://github.com/georzaza/live-radio-song-logger)** can identify
> songs playing on a live radio stream and export a compatible `.csv` to feed straight into this app.

---

## How matching works

For each song without a URL, the app searches YouTube (top 5 results) and scores each candidate on:

- token‑set similarity of `artist + title` vs. the video **title** (weighted) and **channel**, and
- a **duration** bonus/penalty when the input provides a duration.

Scores **≥ 72%** are treated as **confident**; anything lower is **uncertain** and surfaced for
review. You can always override the chosen result per song.

**"In folder" detection** (for duplicates and the filter) resolves, in order: a recorded downloaded
file → the YouTube id embedded in a filename (`... [VIDEOID].ext`) → exact embedded tags →
fuzzy title/filename match.

---

## Output files

Written into the chosen output folder:

- Audio files named `Title [VIDEOID].ext`
- `_download-results.json` / `_download-results.csv` — per‑song outcome log
- `_yt-music-state.json` — the saved queue restored on next launch

---

## Project layout

```
src/
  main.js            Electron main process + IPC
  preload.js         contextBridge API
  renderer/          UI (index.html, styles.css, renderer.js)
  lib/
    binaries.js      download/manage yt-dlp + ffmpeg
    parser.js        parse url/txt/csv into song entries
    ytdlp.js         run yt-dlp (search / info / download)
    matcher.js       score search candidates
    text.js          normalization + similarity
    library.js       scan folder metadata, duplicates, total length
    analyzer.js      resolve + score + dedup each entry
    downloader.js    download one item with progress
    results.js       write results JSON/CSV
    appstate.js      load/save the per-folder queue state
scripts/setup-binaries.js   CLI tool download
```

---

## Troubleshooting

- **"ffprobe and ffmpeg not found"** — click **Set up tools**, or install ffmpeg manually. On
  Windows the app downloads a static build into `./bin` and downloads then re‑run automatically.
- **Nothing happens / buttons dead** — a detached DevTools window opens on launch and renderer
  errors are forwarded to the terminal running `npm start`; check both for the first error.
- **Few songs show as "in folder"** — click **Refresh folder status**. Detection is file‑based, so
  it works even for files downloaded earlier or added manually.

---

## Legal

Downloading copyrighted material may violate YouTube's Terms of Service and/or local law. Use this
tool only for content you are permitted to download. You are responsible for how you use it.

## License

[MIT](LICENSE)
