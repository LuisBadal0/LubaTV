// Serves a made-up IPTV playlist for trying LubaTV without a real provider.
//
//   node scripts/verify/fixtures.mjs <folder> [port]
//
// <folder> holds the generated test videos (created on first run with ffmpeg).
// Endpoints, on http://127.0.0.1:<port> (default 8765):
//   /playlist.m3u      live channels in three groups, plus two movies
//   /live/<n>.ts       a test pattern with a silent audio track, in MPEG-TS
//   /movie/<n>.mp4     the same, as MP4 (LubaTV lists .mp4 links as movies)
//   /logo/<n>.svg      a coloured tile with the channel's initials
//   /requests          JSON list of the stream paths requested so far, to confirm playback

import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const folder = resolve(process.argv[2] ?? "");
const port = Number(process.argv[3] ?? 8765);
if (!process.argv[2]) {
  console.error("usage: node scripts/verify/fixtures.mjs <folder> [port]");
  process.exit(2);
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const base = `http://127.0.0.1:${port}`;

const CHANNELS = [
  { name: "Test News One", group: "News", country: "PT" },
  { name: "Test News Two", group: "News", country: "US" },
  { name: "Test Sports", group: "Sports", country: "PT" },
  { name: "Test Sports Extra", group: "Sports", country: "US" },
  { name: "Test Kids", group: "Kids", country: "PT" },
  { name: "Test Music", group: "Kids", country: "US" },
];
const MOVIES = [
  { name: "Test Movie One", group: "Movies" },
  { name: "Test Movie Two", group: "Movies" },
];
const COLORS = ["#2f6fde", "#d9480f", "#2b8a3e", "#ae3ec9", "#e67700", "#0c8599"];

function ffmpeg() {
  const bundled = join(repo, "src-tauri", "deps", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  return existsSync(bundled) ? bundled : "ffmpeg";
}

function makeVideo(file, format) {
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  console.log(`creating ${file}`);
  execFileSync(
    ffmpeg(),
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25",
      // Silent: an audio track like real streams have, without sound during checks.
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-t", "120",
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      ...(format === "mp4" ? ["-movflags", "+faststart"] : []),
      "-f", format === "mp4" ? "mp4" : "mpegts",
      file,
    ],
    { stdio: "inherit" },
  );
}

function playlist() {
  const lines = ["#EXTM3U"];
  CHANNELS.forEach((c, i) => {
    lines.push(
      `#EXTINF:-1 tvg-id="test.${i + 1}" tvg-name="${c.country}: ${c.name}" tvg-logo="${base}/logo/${i + 1}.svg" group-title="${c.group}",${c.name}`,
      `${base}/live/${i + 1}.ts`,
    );
  });
  MOVIES.forEach((m, i) => {
    lines.push(
      `#EXTINF:-1 tvg-name="${m.name}" tvg-logo="${base}/logo/${CHANNELS.length + i + 1}.svg" group-title="${m.group}",${m.name}`,
      `${base}/movie/${i + 1}.mp4`,
    );
  });
  return lines.join("\n") + "\n";
}

function logo(n) {
  const all = [...CHANNELS, ...MOVIES];
  const item = all[n - 1];
  if (!item) return null;
  const initials = item.name.replace(/^Test /, "").split(" ").map((w) => w[0]).join("").slice(0, 2);
  const color = COLORS[(n - 1) % COLORS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="32" fill="${color}"/><text x="128" y="160" font-family="sans-serif" font-size="96" font-weight="700" fill="#fff" text-anchor="middle">${initials}</text></svg>`;
}

/** Sends a file, honouring a single byte range so players can seek. */
function sendFile(req, res, file, type) {
  const size = statSync(file).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
  createReadStream(file).pipe(res);
}

// New names whenever the videos change, so a kept folder never serves the old ones.
const tsFile = join(folder, "test-silent.ts");
const mp4File = join(folder, "test-silent.mp4");
makeVideo(tsFile, "ts");
makeVideo(mp4File, "mp4");

const requests = [];

createServer((req, res) => {
  const path = new URL(req.url ?? "/", base).pathname;
  let m;
  if (path === "/playlist.m3u") {
    res.writeHead(200, { "Content-Type": "audio/x-mpegurl" }).end(playlist());
  } else if (path === "/requests") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(requests));
  } else if ((m = /^\/logo\/(\d+)\.svg$/.exec(path)) && logo(Number(m[1]))) {
    res.writeHead(200, { "Content-Type": "image/svg+xml" }).end(logo(Number(m[1])));
  } else if ((m = /^\/live\/(\d+)\.ts$/.exec(path)) && Number(m[1]) <= CHANNELS.length) {
    requests.push(path);
    sendFile(req, res, tsFile, "video/mp2t");
  } else if ((m = /^\/movie\/(\d+)\.mp4$/.exec(path)) && Number(m[1]) <= MOVIES.length) {
    requests.push(path);
    sendFile(req, res, mp4File, "video/mp4");
  } else {
    res.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () => console.log(`fixtures on ${base}/playlist.m3u`));
