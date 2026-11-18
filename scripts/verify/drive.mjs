// Drives a running LubaTV for checks: the window through the Chrome DevTools Protocol, the
// players through mpv's IPC. Start the app with scripts/verify/start.ps1 first.
//
//   node scripts/verify/drive.mjs <command> [args]
//
//   wait <css> [ms]           wait until an element matching <css> is visible
//   wait-text <text> [ms]     wait until the page shows <text>
//   text [css]                print the visible text of <css> (default: the whole page)
//   click <css>               click the first visible element matching <css>
//   click-text <text>         click the innermost visible button, link or tile showing <text>
//   type <css> <text>         focus <css>, clear it and type <text>
//   key <key>                 press a key, e.g. Enter, Escape, ArrowDown, Control+f, F1
//   eval <js>                 evaluate <js> in the page (promises are awaited), print JSON
//   screenshot <file.png>     save a picture of the window
//   mpv                       print what each open mpv window plays (path, time, paused)
//   mpv-shot <file.png>       save the current video frame of the newest mpv window
//
// Exit code 0 on success, 1 when a check fails or times out.

import { readdirSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CDP_PORT = Number(process.env.LUBATV_CDP_PORT ?? 9222);
const DEFAULT_TIMEOUT = 15000;

const [command, ...args] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---------- Chrome DevTools Protocol ----------

async function openPage() {
  let targets;
  try {
    targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  } catch {
    fail(`No WebView on port ${CDP_PORT}. Is LubaTV running from scripts/verify/start.ps1?`);
  }
  const page = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools:"));
  if (!page) fail("LubaTV's window has no page yet.");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, ko) => {
    ws.onopen = ok;
    ws.onerror = () => ko(new Error("Could not connect to the WebView"));
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    msg.error ? waiter.ko(new Error(msg.error.message)) : waiter.ok(msg.result);
  };
  const send = (method, params = {}) =>
    new Promise((ok, ko) => {
      const msgId = ++id;
      pending.set(msgId, { ok, ko });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  return { send, close: () => ws.close() };
}

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (exceptionDetails) {
    fail(exceptionDetails.exception?.description ?? exceptionDetails.text);
  }
  return result.value;
}

// Helpers injected into the page. `visible` skips hidden and zero-size elements.
const PAGE_HELPERS = `
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const firstVisible = (css) => [...document.querySelectorAll(css)].find(visible);
  const enabled = (el) => !!el && !el.disabled && el.getAttribute("aria-disabled") !== "true";
  const byText = (text) => {
    const wanted = text.trim().toLowerCase();
    const clickable = 'button, a, [role="button"], [role="radio"], [role="tab"], [role="menuitem"], [tabindex], label';
    const hits = [...document.querySelectorAll(clickable)]
      .filter(visible)
      .filter((el) => el.innerText.trim().toLowerCase().includes(wanted));
    // The innermost match is the one the text belongs to.
    return hits.find((el) => !hits.some((other) => other !== el && el.contains(other)));
  };
`;

async function waitFor(cdp, check, what, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, `(() => { ${PAGE_HELPERS} return !!(${check}); })()`)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  fail(`Timed out after ${timeout} ms waiting for ${what}`);
}

const KEYS = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Tab: { code: "Tab", keyCode: 9 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
};
const MODIFIERS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

function parseKey(spec) {
  const parts = spec.split("+");
  const name = parts.pop();
  let modifiers = 0;
  for (const m of parts) {
    if (!(m in MODIFIERS)) fail(`Unknown modifier ${m}; use Alt, Control, Meta or Shift`);
    modifiers |= MODIFIERS[m];
  }
  let key;
  if (KEYS[name]) key = { key: name, ...KEYS[name] };
  else if (/^F([1-9]|1[0-2])$/.test(name)) key = { key: name, code: name, keyCode: 111 + Number(name.slice(1)) };
  else if (name.length === 1) {
    const upper = name.toUpperCase();
    const code = /[A-Z]/.test(upper) ? `Key${upper}` : /\d/.test(name) ? `Digit${name}` : "";
    key = { key: name, code, keyCode: upper.charCodeAt(0), text: name };
  } else fail(`Unknown key ${name}`);
  // Shortcuts send no text, or the page would also type the letter.
  if (modifiers & (MODIFIERS.Control | MODIFIERS.Alt | MODIFIERS.Meta)) delete key.text;
  return { ...key, modifiers };
}

async function pressKey(cdp, spec) {
  const k = parseKey(spec);
  const common = {
    key: k.key,
    code: k.code,
    windowsVirtualKeyCode: k.keyCode,
    nativeVirtualKeyCode: k.keyCode,
    modifiers: k.modifiers,
  };
  await cdp.send("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", text: k.text, ...common });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
}

async function typeChar(cdp, char) {
  if (/^[a-zA-Z0-9 ]$/.test(char)) {
    await pressKey(cdp, char === " " ? "Space" : char);
    return;
  }
  // Other characters: the text arrives with a keydown/keyup pair but no key code.
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: char, text: char });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: char });
}

// ---------- mpv ----------

/** mpv's IPC pipes, oldest window first (LubaTV numbers them lubatv-mpv-<pid>-<n>). */
function mpvPipes() {
  const windows = process.platform === "win32";
  const folder = windows ? "\\\\.\\pipe\\" : tmpdir();
  const number = (name) => Number(/-(\d+)(\.sock)?$/.exec(name)?.[1] ?? 0);
  return readdirSync(folder)
    .filter((name) => name.startsWith("lubatv-mpv-") && (windows || name.endsWith(".sock")))
    .sort((a, b) => number(a) - number(b))
    .map((name) => (windows ? `${folder}${name}` : join(folder, name)));
}

/** Sends mpv IPC commands; resolves to { <key>: data or null } once all have answered. */
function askMpv(path, commands, timeout = 2000) {
  const keys = Object.keys(commands);
  return new Promise((ok) => {
    const socket = connect(path);
    const answers = {};
    let buffer = "";
    const done = () => {
      socket.destroy();
      ok(answers);
    };
    const timer = setTimeout(done, timeout);
    socket.on("error", () => {
      clearTimeout(timer);
      ok({ error: "not answering" });
    });
    socket.on("connect", () => {
      keys.forEach((k, i) =>
        socket.write(JSON.stringify({ command: commands[k], request_id: i + 1 }) + "\n"),
      );
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (!msg.request_id) continue;
        answers[keys[msg.request_id - 1]] = msg.error === "success" ? (msg.data ?? true) : null;
        if (Object.keys(answers).length === keys.length) {
          clearTimeout(timer);
          done();
        }
      }
    });
  });
}

// ---------- commands ----------

async function run() {
  if (command === "mpv") {
    const properties = ["path", "media-title", "playback-time", "pause", "idle-active", "width", "height"];
    const players = [];
    for (const pipe of mpvPipes()) {
      players.push({
        pipe,
        ...(await askMpv(pipe, Object.fromEntries(properties.map((p) => [p, ["get_property", p]])))),
      });
    }
    console.log(JSON.stringify(players, null, 2));
    return;
  }
  if (command === "mpv-shot") {
    if (!args[0]) fail("usage: mpv-shot <file.png>");
    const pipe = mpvPipes().at(-1);
    if (!pipe) fail("No mpv window is open.");
    const file = resolve(args[0]);
    const { shot } = await askMpv(pipe, { shot: ["screenshot-to-file", file, "video"] }, 5000);
    if (!shot) fail(`mpv could not save a picture to ${file}`);
    console.log(file);
    return;
  }

  const cdp = await openPage();
  try {
    switch (command) {
      case "wait": {
        const [css, ms] = args;
        await waitFor(cdp, `firstVisible(${JSON.stringify(css)})`, css, Number(ms ?? DEFAULT_TIMEOUT));
        break;
      }
      case "wait-text": {
        const [text, ms] = args;
        await waitFor(
          cdp,
          `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`,
          `"${text}"`,
          Number(ms ?? DEFAULT_TIMEOUT),
        );
        break;
      }
      case "text": {
        const css = args[0] ?? "body";
        const text = await evaluate(cdp, `(() => { ${PAGE_HELPERS} const el = firstVisible(${JSON.stringify(css)}); return el ? el.innerText : null; })()`);
        if (text === null) fail(`Nothing visible matches ${css}`);
        console.log(text);
        break;
      }
      case "click": {
        const find = `firstVisible(${JSON.stringify(args[0])})`;
        await waitFor(cdp, `enabled(${find})`, `an enabled ${args[0]}`, DEFAULT_TIMEOUT);
        await evaluate(cdp, `(() => { ${PAGE_HELPERS} const el = ${find}; el.scrollIntoView({ block: "center" }); el.click(); })()`);
        break;
      }
      case "click-text": {
        const find = `byText(${JSON.stringify(args[0])})`;
        await waitFor(cdp, `enabled(${find})`, `an enabled element showing "${args[0]}"`, DEFAULT_TIMEOUT);
        await evaluate(cdp, `(() => { ${PAGE_HELPERS} const el = ${find}; el.scrollIntoView({ block: "center" }); el.click(); })()`);
        break;
      }
      case "type": {
        const [css, text] = args;
        const find = `firstVisible(${JSON.stringify(css)})`;
        await waitFor(cdp, `enabled(${find})`, `an enabled ${css}`, DEFAULT_TIMEOUT);
        await evaluate(cdp, `(() => { ${PAGE_HELPERS} const el = ${find}; el.focus(); el.select?.(); })()`);
        // Real key presses, so keydown/keyup listeners (like the search box's) see them.
        for (const char of text ?? "") await typeChar(cdp, char);
        break;
      }
      case "key":
        await pressKey(cdp, args[0]);
        break;
      case "eval":
        console.log(JSON.stringify(await evaluate(cdp, args.join(" ")), null, 2));
        break;
      case "screenshot": {
        if (!args[0]) fail("usage: screenshot <file.png>");
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(args[0], Buffer.from(data, "base64"));
        console.log(args[0]);
        break;
      }
      default:
        fail(`Unknown command ${command ?? "(none)"}. See the top of scripts/verify/drive.mjs.`);
    }
  } finally {
    cdp.close();
  }
}

run().catch((e) => fail(e.message));
