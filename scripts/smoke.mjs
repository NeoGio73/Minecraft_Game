#!/usr/bin/env node
/**
 * Playwright smoke test (docs/design/06-engine.md §15.2; 09-amendment-no-bond.md §5.10).
 *
 * Serves dist/ under a deep D2L-style path, drives the built game in headless
 * Chromium (software WebGL) twice -- top-level (standalone mode) and inside a
 * wrapper page that defines a fake SCORM 1.2 `window.API` (LMS mode) -- through
 * the DebugApi on window.__orgocraft, and fails on any console error or
 * uncaught exception. Prints a step-by-step log; exit code 1 on any failure.
 * Steps 23-27 cover the engineering-review fixes: the 5x5 sheet never stalls
 * the frame loop (analysis worker), select-atom picks and the empty-selection
 * submit, the T key, the hover-only highlight path and the out-of-view pause.
 *
 *   npm run build && npm run smoke
 *   CHROMIUM_PATH=/path/to/chrome npm run smoke      (CHROME_PATH is accepted as an alias; otherwise
 *                                                     $PLAYWRIGHT_BROWSERS_PATH/chromium-* is searched, then
 *                                                     /opt/pw-browsers/chromium-* and ~/.cache/ms-playwright)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const PREFIX = '/content/enforced/12345-ORGO/orgocraft-v1/';
const STEP_TIMEOUT_MS = 20_000;
const LIVE_POLITE_MS = 1000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// Browser binary
// ---------------------------------------------------------------------------

function findChrome() {
  for (const key of ['CHROMIUM_PATH', 'CHROME_PATH']) {
    const p = process.env[key];
    if (p && existsSync(p)) return p;
  }
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', join(process.env.HOME ?? '', '.cache/ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse();
    for (const d of dirs) {
      for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        const p = join(root, d, sub);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Static server: dist/ under PREFIX, the SCORM wrapper at /scorm/wrapper.html
// ---------------------------------------------------------------------------

const WRAPPER = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>SCORM wrapper</title><link rel="icon" href="data:,">
<style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0;display:block}</style>
<script>
(function () {
  var data = { 'cmi.core.student_id': 'stu-smoke', 'cmi.core.student_name': 'Smoke, Test', 'cmi.core.lesson_mode': 'normal',
    'cmi.core.lesson_status': 'not attempted', 'cmi.core.entry': 'ab-initio', 'cmi.suspend_data': '', 'cmi.core.lesson_location': '',
    'cmi.core.score.raw': '', 'cmi.core.score.min': '', 'cmi.core.score.max': '', 'cmi.student_data.mastery_score': '70', 'cmi.core.credit': 'credit' };
  var calls = [];
  window.__api = { calls: calls, data: data };
  window.API = {
    LMSInitialize: function (p) { calls.push(['LMSInitialize', p]); return 'true'; },
    LMSFinish: function (p) { calls.push(['LMSFinish', p]); return 'true'; },
    LMSGetValue: function (k) { calls.push(['LMSGetValue', k]); return data[k] === undefined ? '' : data[k]; },
    LMSSetValue: function (k, v) { calls.push(['LMSSetValue', k, String(v)]); data[k] = String(v); return 'true'; },
    LMSCommit: function (p) { calls.push(['LMSCommit', p]); return 'true'; },
    LMSGetLastError: function () { return '0'; },
    LMSGetErrorString: function (c) { return 'No error ' + c; },
    LMSGetDiagnostic: function (c) { return 'diag ' + c; }
  };
})();
</script></head>
<body><iframe name="sco" title="OrgoCraft" src="${PREFIX}index.html?debug=1"></iframe></body></html>`;

function startServer() {
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/scorm/wrapper.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(WRAPPER);
      return;
    }
    if (!url.startsWith(PREFIX)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const rel = url.slice(PREFIX.length) || 'index.html';
    const file = resolve(DIST, rel);
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

class StepFailure extends Error {}

function assert(cond, message) {
  if (!cond) throw new StepFailure(message);
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new StepFailure(`timed out after ${ms} ms: ${label}`)), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Polls `fn` (in node) until it returns truthy or `ms` elapsed; `detail()` is appended to the failure. */
async function until(fn, ms, label, detail = null) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) {
      let extra = '';
      if (detail) {
        try { extra = ` (observed: ${JSON.stringify(await detail())})`; } catch (e) { extra = ` (detail failed: ${e})`; }
      }
      throw new StepFailure(`condition not met within ${ms} ms: ${label}${extra}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Run {
  constructor(mode, log) {
    this.mode = mode;
    this.log = log;
    this.failures = [];
    this.steps = 0;
  }
  async step(id, title, fn, only = null) {
    if (only && only !== this.mode) {
      this.log(`[${this.mode}] step ${id} (${title}) skipped: ${only} only`);
      return;
    }
    this.steps++;
    const t0 = Date.now();
    try {
      await withTimeout(fn(), STEP_TIMEOUT_MS, `step ${id} ${title}`);
      this.log(`[${this.mode}] step ${id} ok (${Date.now() - t0} ms): ${title}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.failures.push(`[${this.mode}] step ${id} ${title}: ${msg}`);
      this.log(`[${this.mode}] step ${id} FAILED: ${title}\n    ${msg.split('\n').join('\n    ')}`);
    }
  }
}

function attachErrorCollectors(page, errors, tag) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${tag} console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
}

// ---------------------------------------------------------------------------
// The scripted steps (06 §15.2)
// ---------------------------------------------------------------------------

async function runScript({ browser, baseUrl, mode, log, screenshotPaths }) {
  const run = new Run(mode, log);
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  attachErrorCollectors(page, errors, mode);
  const url = mode === 'lms' ? `${baseUrl}/scorm/wrapper.html` : `${baseUrl}${PREFIX}index.html?debug=1`;
  await page.goto(url);
  /** The frame that runs the game (the page itself in standalone mode). */
  let t = page;
  if (mode === 'lms') {
    t = await until(() => page.frame({ name: 'sco' }), 5000, 'sco frame');
    await t.waitForLoadState('load');
  }
  const api = (fn, arg) => t.evaluate(fn, arg);
  const stateOf = (fn) => t.evaluate(fn);
  const text = (sel) => t.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel);
  /** Text of an element without its aria-hidden glyph spans (the feedback rows start with a decorative glyph). */
  const plainText = (sel) => t.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return '';
    const clone = el.cloneNode(true);
    for (const g of clone.querySelectorAll('[aria-hidden="true"]')) g.remove();
    return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
  }, sel);
  const feedback = () => plainText('#challenge-panel .cp-feedback');
  /** Clicks through the DOM (no actionability wait): the HUD is the subject, not Playwright's hit-testing. */
  const jsClick = (sel) => t.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error('no element ' + s);
    el.click();
  }, sel);
  /** Key press followed by at least two rendered frames (edge actions are deduplicated per frame). */
  const pressKey = async (key) => {
    const f0 = await t.evaluate(() => window.__orgocraft.frames);
    await page.keyboard.press(key);
    await until(() => t.evaluate((f) => window.__orgocraft.frames >= f + 2, f0), 3000, `frames after ${key}`);
  };
  const visible = (sel) => t.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    if (el.hasAttribute('hidden') || el.closest('[hidden]')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, sel);
  const focusCanvas = async () => {
    await t.evaluate(() => document.getElementById('canvas').focus({ preventScroll: true }));
  };
  /** Escapes out of any open dialog (a failed earlier step may have left one open). */
  const closeDialogs = async () => {
    for (let i = 0; i < 4; i++) {
      const open = await t.evaluate(() => Array.from(document.querySelectorAll('#dialogs [role="dialog"], #dialogs [role="alertdialog"]')).some((d) => !d.hasAttribute('hidden')));
      if (!open) return;
      await page.keyboard.press('Escape');
      await sleep(100);
    }
  };
  const apiRecord = () => page.evaluate(() => window.__api ?? null);
  const setsOf = (rec, key) => rec.calls.filter((c) => c[0] === 'LMSSetValue' && c[1] === key).map((c) => c[2]);

  // 1 ----------------------------------------------------------------------
  await run.step(1, 'frame counter advances and the world has triangles', async () => {
    await t.waitForFunction(() => window.__orgocraft?.ready === true && window.__orgocraft.frames > 10 && window.__orgocraft.triangles > 0, null, { timeout: STEP_TIMEOUT_MS });
    const hasGl = await t.evaluate(() => {
      const c = document.getElementById('canvas');
      return !!(c && (c.getContext('webgl2') || c.getContext('webgl')));
    });
    assert(hasGl, 'canvas#canvas has no WebGL context');
    const f1 = await t.evaluate(() => window.__orgocraft.frames);
    await sleep(300);
    const f2 = await t.evaluate(() => window.__orgocraft.frames);
    assert(f2 > f1, `frame counter did not advance (${f1} -> ${f2})`);
  });

  // 2 ----------------------------------------------------------------------
  await run.step(2, 'world blocks: LabTile under spawn, Bench console', async () => {
    const [a, b] = await t.evaluate(() => [window.__orgocraft.getBlock(64, 8, 64), window.__orgocraft.getBlock(63, 9, 49)]);
    assert(a === 7, `getBlock(64,8,64) = ${a}, expected 7 (LabTile)`);
    assert(b === 9, `getBlock(63,9,49) = ${b}, expected 9 (Bench)`);
  });

  // 3 ----------------------------------------------------------------------
  await run.step(3, 'click focuses the canvas; look mode falls back to drag (or locks)', async () => {
    await t.click('canvas#canvas', { position: { x: 640, y: 360 } });
    const focused = await t.evaluate(() => document.activeElement === document.getElementById('canvas'));
    assert(focused, 'canvas is not the active element after the click');
    const mode = await until(async () => {
      const m = await t.evaluate(() => window.__orgocraft.lookMode);
      return m === 'drag' || m === 'locked' ? m : null;
    }, 3000, 'look mode drag/locked');
    if (mode === 'drag') {
      await until(async () => (await text('#look-hint')).includes('Drag'), 1500, '#look-hint mentions Drag');
    } else {
      log(`[${mode}] note: headless Chromium granted pointer lock; the drag fallback was not exercised`);
    }
  });

  // 20 ---------------------------------------------------------------------
  await run.step(20, 'F3 toggles the debug overlay', async () => {
    await focusCanvas();
    await page.keyboard.press('F3');
    await until(() => visible('#debug'), 2000, '#debug visible');
    assert((await text('#debug')).includes('fps'), '#debug has no fps line');
    await page.keyboard.press('F3');
    await until(async () => !(await visible('#debug')), 2000, '#debug hidden again');
  });

  // 4 ----------------------------------------------------------------------
  await run.step(4, 'LMS badge text', async () => {
    const expected = mode === 'lms' ? 'Connected to course gradebook' : 'Progress saved on this device - not connected to the gradebook';
    await until(async () => (await text('#lms-badge')).trim() === expected, 6000, `#lms-badge reads "${expected}"`);
  });

  // 5 ----------------------------------------------------------------------
  await run.step(5, 'methane: place one carbon with the keyboard; panel names it', async () => {
    await api(() => window.__orgocraft.goToChallenge('ch1-build-methane'));
    await api(() => window.__orgocraft.teleport(64.5, 9, 62.5, 0, -0.6));
    await focusCanvas();
    await sleep(100);
    await page.keyboard.press('Digit1');
    await sleep(60);
    await page.keyboard.press('KeyE');
    await until(async () => (await t.evaluate(() => window.__orgocraft.getBlock(64, 9, 60))) === 64, 2000, 'AtomC at (64,9,60)');
    await until(async () => (await text('#molecule-panel .mp-name')).trim().toLowerCase() === 'methane', 2000, '.mp-name reads methane');
    const formula = await t.evaluate(() => document.querySelector('#molecule-panel .mp-facts dd[aria-label]')?.getAttribute('aria-label'));
    assert(formula === 'CH4', `formula aria-label is ${formula}, expected CH4`);
  });

  // 6 ----------------------------------------------------------------------
  await run.step(6, 'Enter submits: Correct, Solved, announced, score written', async () => {
    await focusCanvas();
    await pressKey('Enter');
    await until(async () => (await feedback()).startsWith('Correct:'), 2000, '.cp-feedback starts with Correct:', feedback);
    await until(async () => (await text('#challenge-panel .cp-status')).includes('Solved'), 2000, '.cp-status contains Solved');
    // The feedback sentence is queued (sticky) ahead of the pass announcement, and the gradebook commit adds one more
    // polite message in LMS mode, so allow a few LIVE_POLITE_MS windows (07 §16.1 queue semantics).
    await until(async () => (await text('#status')).includes('Solved:'), 3 * LIVE_POLITE_MS + 500, '#status contains Solved:', () => text('#status'));
    if (mode === 'lms') {
      const rec = await apiRecord();
      const raws = setsOf(rec, 'cmi.core.score.raw').map(Number);
      assert(raws.some((r) => r > 0), `fake API saw no cmi.core.score.raw > 0 (${JSON.stringify(raws)})`);
      const sus = setsOf(rec, 'cmi.suspend_data');
      assert(sus.length > 0 && sus[sus.length - 1].startsWith('v2|'), `cmi.suspend_data not written as v2| (${JSON.stringify(sus)})`);
    }
  });

  // 7 ----------------------------------------------------------------------
  await run.step(7, 'Space / ArrowDown / PageDown never scroll the page', async () => {
    await focusCanvas();
    const before = await page.evaluate(() => window.scrollY);
    const beforeInner = await t.evaluate(() => window.scrollY);
    for (const k of ['Space', 'ArrowDown', 'PageDown']) await page.keyboard.press(k);
    await sleep(150);
    assert((await page.evaluate(() => window.scrollY)) === before, 'outer page scrolled');
    assert((await t.evaluate(() => window.scrollY)) === beforeInner, 'game page scrolled');
  });

  // 8 ----------------------------------------------------------------------
  await run.step(8, 'select-H: cycle with ] six times, E selects the O-H hydrogen, Enter passes', async () => {
    await api(() => window.__orgocraft.goToChallenge('ch2-select-most-acidic-h-ethanol'));
    await t.waitForFunction(() => {
      const s = window.__orgocraft.state();
      return s.locked.length === 1 && s.locked[0].atomToCell.length === 3;
    }, null, { timeout: 5000 });
    await until(() => t.evaluate(() => window.__orgocraft.state().padComponents.some((c) => c.locked)), 3000, 'locked ethanol analysed');
    await focusCanvas();
    await pressKey('KeyV');
    for (let i = 0; i < 6; i++) await pressKey('BracketRight');
    await pressKey('KeyE');
    const sel = await until(async () => {
      const s = await t.evaluate(() => window.__orgocraft.state().selection);
      return s.length === 1 ? s : null;
    }, 2000, 'one selected item');
    assert(JSON.stringify(sel) === JSON.stringify([{ molecule: 0, atom: 2, hSlot: 0 }]), `selection is ${JSON.stringify(sel)}`);
    await pressKey('Enter');
    await until(async () => (await feedback()).startsWith('Correct:'), 2000, '.cp-feedback starts with Correct:', feedback);
  });

  // 9 ----------------------------------------------------------------------
  await run.step(9, 'heavy-atom fallback on an O without hydrogens shows the toast', async () => {
    await api(() => window.__orgocraft.goToChallenge('ch2-select-most-acidic-h-pentane-2-4-dione'));
    await t.waitForFunction(() => window.__orgocraft.state().locked.length === 1, null, { timeout: 5000 });
    const view = await t.evaluate(() => {
      const s = window.__orgocraft.state();
      const lp = s.locked[0];
      const get = window.__orgocraft.getBlock;
      const dirs = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];
      for (let atom = 0; atom < lp.atomToCell.length; atom++) {
        const info = lp.analysis.atoms[atom];
        if (info.el !== 'O' || lp.analysis.hydrogens[atom] !== 0) continue;
        const [x, y, z] = lp.atomToCell[atom].split(',').map(Number);
        for (const d of dirs) {
          let free = true;
          for (let k = 1; k <= 4; k++) if (get(x + d[0] * k, y, z + d[2] * k) !== 0 || get(x + d[0] * k, y - 1, z + d[2] * k) !== 0 || get(x + d[0] * k, y - 2, z + d[2] * k) !== 0) free = false;
          if (!free) continue;
          const px = x + d[0] * 4 + 0.5;
          const pz = z + d[2] * 4 + 0.5;
          // forward(yaw) = (-sin yaw, 0, -cos yaw) must equal -d
          const yaw = d[2] === 1 ? 0 : d[2] === -1 ? Math.PI : d[0] === 1 ? Math.PI / 2 : -Math.PI / 2;
          const feet = 9;   // the pad floor is y = 8; the player settles at y = 9
          return { atom, cell: lp.atomToCell[atom], px, py: feet, pz, yaw, pitch: Math.atan2(y + 0.5 - (feet + 1.62), 4) };
        }
      }
      return null;
    });
    assert(view, 'no oxygen without hydrogens with a free approach found');
    await api((v) => window.__orgocraft.teleport(v.px, v.py, v.pz, v.yaw, v.pitch), view);
    await focusCanvas();
    await until(() => t.evaluate((cell) => {
      const h = window.__orgocraft.state().target.cell;
      return h === cell;
    }, view.cell), 3000, `hover on the oxygen cell ${view.cell}`);
    await sleep(150);
    await pressKey('KeyE');
    await until(async () => (await text('#toast')).trim().startsWith('That atom has no hydrogens'), 2000, '#toast says That atom has no hydrogens');
    const sel = await t.evaluate(() => window.__orgocraft.state().selection);
    assert(sel.length === 0, `selection should be empty, is ${JSON.stringify(sel)}`);
  });

  // 10 ---------------------------------------------------------------------
  await run.step(10, 'quiz: open, press 2 twice, feedback rendered, quiz:answer observed', async () => {
    const id = await t.evaluate(() => window.__orgocraft.state().roster.find((c) => c.rule.type === 'quiz').id);
    await t.evaluate(() => { window.__quizAnswers = []; window.__orgocraft.events.on('quiz:answer', (e) => window.__quizAnswers.push(e)); });
    await api((i) => window.__orgocraft.goToChallenge(i), id);
    await sleep(300);
    if (!(await visible('#dialogs [role="dialog"]:not([hidden])'))) await jsClick('#cp-answer');
    await until(() => visible('#quiz'), 3000, '#quiz dialog visible');
    await page.keyboard.press('Digit2');
    await sleep(80);
    await page.keyboard.press('Digit2');
    await until(async () => (await text('#quiz .quiz-feedback')).trim().length > 0, 2000, '.quiz-feedback non-empty');
    const answers = await t.evaluate(() => window.__quizAnswers);
    assert(answers.length === 1, `expected one quiz:answer event, saw ${answers.length}`);
    await page.keyboard.press('Escape');
    await until(async () => !(await visible('#quiz')), 2000, '#quiz closed');
  });

  // 11 ---------------------------------------------------------------------
  await run.step(11, 'keyboard only: Escape opens the pause menu, Tab is trapped, Escape/Enter resume', async () => {
    await closeDialogs();
    await focusCanvas();
    await page.keyboard.press('Escape');
    await until(() => visible('#pause'), 2000, '#pause visible');
    assert((await t.evaluate(() => document.activeElement?.id)) === 'pm-resume', 'focus is not on #pm-resume');
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Tab');
      const inside = await t.evaluate(() => document.getElementById('pause').contains(document.activeElement));
      assert(inside, `focus left #pause after ${i + 1} Tabs`);
    }
    await page.keyboard.press('Escape');
    await until(async () => !(await visible('#pause')), 2000, '#pause hidden');
    assert((await t.evaluate(() => document.activeElement?.id)) === 'canvas', 'focus did not return to the canvas');
    await page.keyboard.press('Escape');
    await until(() => visible('#pause'), 2000, '#pause visible again');
    assert((await t.evaluate(() => document.activeElement?.id)) === 'pm-resume', 'focus is not on #pm-resume (2)');
    await page.keyboard.press('Enter');
    await until(async () => !(await visible('#pause')), 2000, '#pause hidden after Enter');
  });

  // 12 ---------------------------------------------------------------------
  await run.step(12, 'Tab from the canvas lands in the molecule panel', async () => {
    await focusCanvas();
    await page.keyboard.press('Tab');
    const where = await t.evaluate(() => document.activeElement?.closest('#molecule-panel') !== null);
    assert(where, `Tab from the canvas landed on ${await t.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))}`);
  });

  // 13 ---------------------------------------------------------------------
  await run.step(13, 'keyboard focus on the canvas shows the two-tone inset ring', async () => {
    await t.evaluate(() => {
      const panel = document.getElementById('challenge-panel');
      const list = Array.from(panel.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.disabled && !el.hasAttribute('hidden') && !el.closest('[hidden]') && el.getClientRects().length > 0);
      list[list.length - 1].focus();
    });
    await page.keyboard.press('Tab');
    const r = await t.evaluate(() => {
      const c = document.getElementById('canvas');
      const cs = getComputedStyle(c);
      return { active: document.activeElement === c, offset: parseFloat(cs.outlineOffset), width: cs.outlineWidth };
    });
    assert(r.active, 'Tab from the challenge panel did not focus the canvas');
    assert(r.offset < 0, `outline-offset is ${r.offset}, expected negative`);
    assert(r.width === '3px', `outline-width is ${r.width}, expected 3px`);
  });

  // 14 ---------------------------------------------------------------------
  await run.step(14, 'live regions stay outside the inert HUD while the pause menu is open', async () => {
    await closeDialogs();
    await focusCanvas();
    await page.keyboard.press('Escape');
    await until(() => visible('#pause'), 2000, '#pause visible');
    await api(() => window.__orgocraft.state().announce('x', 'assertive'));
    await until(async () => (await text('#toast')).trim() === 'x', 2000, '#toast reads x');
    const toast = await t.evaluate(() => {
      const el = document.getElementById('toast');
      return { inert: el.closest('[inert]') !== null, hidden: el.hasAttribute('aria-hidden') };
    });
    assert(!toast.inert && !toast.hidden, '#toast is inert or aria-hidden');
    await api(() => window.__orgocraft.state().announce('y', 'polite'));
    await until(async () => (await text('#status')).trim() === 'y', LIVE_POLITE_MS + 1500, '#status reads y', () => text('#status'));
    const status = await t.evaluate(() => {
      const el = document.getElementById('status');
      return { inert: el.closest('[inert]') !== null, hidden: el.hasAttribute('aria-hidden') };
    });
    assert(!status.inert && !status.hidden, '#status is inert or aria-hidden');
    await page.keyboard.press('Escape');
    await until(async () => !(await visible('#pause')), 2000, '#pause hidden');
  });

  // 16 ---------------------------------------------------------------------
  await run.step(16, 'axe-core on the HUD with the pause menu open', async () => {
    const axe = join(ROOT, 'node_modules/axe-core/axe.min.js');
    assert(existsSync(axe), 'axe-core is not installed (npm install -D axe-core); this step never skips');
    await focusCanvas();
    await page.keyboard.press('Escape');
    await until(() => visible('#pause'), 2000, '#pause visible');
    await t.addScriptTag({ content: readFileSync(axe, 'utf8') });
    const result = await t.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
    const describe = (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join('; ')}`;
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.id === 'aria-allowed-role');
    const rest = result.violations.filter((v) => !bad.includes(v));
    log(`[${mode}] axe-core ${result.testEngine?.version ?? ''}: ${result.violations.length} violation(s)${rest.length ? ' (minor/moderate: ' + rest.map(describe).join('; ') + ')' : ''}`);
    assert(bad.length === 0, `axe violations: ${bad.map(describe).join('\n')}`);
    await page.keyboard.press('Escape');
    await until(async () => !(await visible('#pause')), 2000, '#pause hidden');
  });

  // 17 ---------------------------------------------------------------------
  await run.step(17, 'bench: React hides the answers; build E-but-2-ene with the wand; submit', async () => {
    await closeDialogs();
    await api(() => window.__orgocraft.goToChallenge('ch11-predict-e2-2-bromobutane'));
    await focusCanvas();
    await page.keyboard.press('KeyR');
    await until(() => visible('#bench-panel'), 2000, '#bench-panel visible');
    await jsClick('#bp-react');
    await until(async () => (await text('#bench-panel .bp-mech')).trim().length > 0, 2000, '.bp-mech non-empty');
    const minor = (await text('#bench-panel .bp-minor')).trim();
    assert(minor === '', `.bp-minor should be empty before the pass, reads "${minor}"`);
    const panelText = await text('#bench-panel');
    assert(!panelText.includes('but-1-ene') && !panelText.includes('2-ethoxybutane'), 'bench panel leaks product names before the pass');
    const st = await t.evaluate(() => { const s = window.__orgocraft.state(); return { mode: s.bench.mode, outcome: s.outcomeOf(s.current.challenge.id) }; });
    assert(st.mode === 'predict' && st.outcome < 2, `bench mode ${st.mode}, outcome ${st.outcome}`);
    await api(() => window.__orgocraft.teleport(70.5, 9, 44.5, 0, 0));
    const placed = await t.evaluate(() => [[65, 10, 37], [66, 10, 37], [66, 10, 38], [67, 10, 38]].map((p) => window.__orgocraft.place(p[0], p[1], p[2], 'C')));
    assert(placed.every((r) => r.ok), `placement refused: ${JSON.stringify(placed.filter((r) => !r.ok))}`);
    // Look straight down at the C2-C3 bar (06 §10.2: the bar wins when its pick box is just behind the cell face).
    await api(() => window.__orgocraft.teleport(66.5, 11, 38, 0, -1.55));
    await focusCanvas();
    await pressKey('KeyB');
    await until(() => t.evaluate(() => window.__orgocraft.state().target.pair === '66,10,37|66,10,38'), 3000, 'hover on the C2-C3 bond bar');
    await pressKey('KeyE');
    const name = await until(async () => {
      const s = await t.evaluate(() => window.__orgocraft.state().padComponents.map((c) => c.analysis.name));
      return s.includes('(E)-but-2-ene') ? s : null;
    }, 3000, 'padComponents name (E)-but-2-ene');
    log(`[${mode}] product-zone names: ${JSON.stringify(name)}`);
    await jsClick('#bp-submit');
    await until(async () => (await feedback()).startsWith('Correct:'), 3000, '.cp-feedback starts with Correct:', feedback);
    await until(async () => (await text('#bench-panel .bp-minor')).includes('Minor product: but-1-ene'), 2000, '.bp-minor lists but-1-ene');
    await page.keyboard.press('KeyR');
  });

  // 17a --------------------------------------------------------------------
  await run.step('17a', 'no bond: Z-but-2-ene square, wand to the break marker, submit', async () => {
    await api(() => window.__orgocraft.goToChallenge('ch7-build-z-but-2-ene'));
    await api(() => window.__orgocraft.teleport(60.5, 9, 64.5, 0, -0.45));
    await focusCanvas();
    const placed = await t.evaluate(() => [[60, 9, 60], [60, 9, 61], [61, 9, 61], [61, 9, 60]].map((p) => window.__orgocraft.place(p[0], p[1], p[2], 'C')));
    assert(placed.every((r) => r.ok), `placement refused: ${JSON.stringify(placed.filter((r) => !r.ok))}`);
    await until(() => t.evaluate(() => window.__orgocraft.state().target.atomToCell.length === 4), 3000, 'the square is targeted');
    await pressKey('Enter');
    await until(async () => {
      const f = await feedback();
      return f.startsWith('Not yet:') && f.includes('break marker');
    }, 3000, '.cp-feedback: Not yet + break marker', feedback);
    const orders = await t.evaluate(() => [1, 2, 3].map(() => window.__orgocraft.wand('60,9,60|61,9,60')).map((r) => (r.ok ? r.order : r.message)));
    assert(JSON.stringify(orders) === '[2,3,0]', `wand orders ${JSON.stringify(orders)}, expected [2,3,0]`);
    await until(() => t.evaluate(() => JSON.stringify(window.__orgocraft.state().target.suppressed) === JSON.stringify(['60,9,60|61,9,60'])), 3000, 'target.suppressed');
    // Polite announcements are latest-wins within LIVE_POLITE_MS (07 §16.1), so the "removed" message is checked before
    // the next wand edit (C2=C3 double) replaces it; 09 §5.10 lists the check after that edit, which the policy forbids.
    await until(async () => (await text('#status')).includes('removed: the atoms touch'), LIVE_POLITE_MS + 2500, '#status announces the removed bond', () => text('#status'));
    const dbl = await t.evaluate(() => window.__orgocraft.wand('60,9,61|61,9,61'));
    assert(dbl.ok && dbl.order === 2, `C2=C3 wand gave ${JSON.stringify(dbl)}`);
    await until(async () => (await text('#molecule-panel .mp-name')).trim() === '(Z)-but-2-ene', 3000, '.mp-name reads (Z)-but-2-ene');
    await focusCanvas();
    await pressKey('Enter');
    await until(async () => (await feedback()).startsWith('Correct:'), 3000, '.cp-feedback starts with Correct:', feedback);
  });

  // 22 (screenshot of the standalone run, taken while the molecules are in view)
  if (mode === 'standalone') {
    await run.step(22, 'screenshot', async () => {
      await api(() => window.__orgocraft.teleport(62.5, 9, 66.5, 0.35, -0.3));
      await sleep(400);
      for (const p of screenshotPaths) {
        mkdirSync(join(p, '..'), { recursive: true });
        await page.screenshot({ path: p });
        log(`[${mode}] screenshot written to ${p}`);
      }
    });
  }

  // 23 ---------------------------------------------------------------------
  await run.step(23, '5x5 carbon sheet: no frame gap over 500 ms, the page keeps answering, the worker analyses it', async () => {
    await closeDialogs();
    await api(() => window.__orgocraft.goToChallenge('ch1-build-methane'));
    await api(() => window.__orgocraft.teleport(56.5, 9, 73.5, 0, -0.35));
    await focusCanvas();
    assert(await t.evaluate(() => window.__orgocraft.analysisWorker === true), 'the analysis worker is not active (synchronous fallback in use)');
    // an in-page requestAnimationFrame watchdog records every frame gap while the sheet is built and analysed
    await t.evaluate(() => {
      window.__gaps = [];
      window.__gapsOn = true;
      let last = performance.now();
      const tick = (now) => { window.__gaps.push(now - last); last = now; if (window.__gapsOn) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    // one carbon per frame, like a student: every placement re-queues the growing component for analysis
    const cells = [];
    for (let x = 54; x < 59; x++) for (let z = 66; z < 71; z++) cells.push([x, 9, z]);
    for (const c of cells) {
      const r = await api((p) => window.__orgocraft.place(p[0], p[1], p[2], 'C'), c);
      assert(r.ok, `placement of ${JSON.stringify(c)} refused: ${r.message}`);
      const f0 = await t.evaluate(() => window.__orgocraft.frames);
      await until(() => t.evaluate((f) => window.__orgocraft.frames > f, f0), 2000, 'a frame after the placement');
    }
    let slowest = 0;
    await until(async () => {
      const t0 = Date.now();
      const done = await t.evaluate(() => window.__orgocraft.state().padComponents.some((c) => c.analysis.formula === 'C25H20'));
      slowest = Math.max(slowest, Date.now() - t0);
      return done;
    }, 15000, 'the 25-carbon sheet is analysed (C25H20)');
    assert(slowest < 500, `a page round trip took ${slowest} ms while the sheet was analysed`);
    const gaps = await t.evaluate(() => { window.__gapsOn = false; return window.__gaps; });
    const worst = Math.max(...gaps);
    log(`[${mode}] sheet: ${gaps.length} frames, worst frame gap ${worst.toFixed(0)} ms, slowest round trip ${slowest} ms`);
    assert(worst < 500, `a frame gap of ${worst.toFixed(0)} ms during the sheet build`);
    await until(async () => (await text('#molecule-panel .mp-centers')).includes('cannot assign'), 3000, 'the panel lists CANNOT_ASSIGN centres', () => text('#molecule-panel .mp-centers'));
  });

  // 24 ---------------------------------------------------------------------
  await run.step(24, "select-atom: Place on the student's own atom selects nothing; Submit is disabled and consumes nothing while empty", async () => {
    await api(() => window.__orgocraft.goToChallenge('ch1-select-sp2-propene'));
    await t.waitForFunction(() => window.__orgocraft.state().locked.length === 1, null, { timeout: 5000 });
    // the methane carbon from step 5 at (64, 9, 60) is the student's own atom, outside the reserved slot box
    assert((await t.evaluate(() => window.__orgocraft.getBlock(64, 9, 60))) === 64, 'the student carbon at (64,9,60) is gone');
    await api(() => window.__orgocraft.teleport(64.5, 9, 64.5, 0, -0.27));
    await focusCanvas();
    await until(() => t.evaluate(() => window.__orgocraft.state().target.cell === '64,9,60'), 3000, 'hover on the student carbon', () => t.evaluate(() => window.__orgocraft.state().target));
    const id = await t.evaluate(() => window.__orgocraft.state().current.challenge.id);
    const attemptBefore = await t.evaluate((i) => window.__orgocraft.state().attemptOf(i), id);
    const attemptsLine = await text('#challenge-panel .cp-attempts');
    await pressKey('KeyE');
    await sleep(150);
    const sel = await t.evaluate(() => window.__orgocraft.state().selection);
    assert(sel.length === 0, `Place on the student's own atom produced the selection ${JSON.stringify(sel)}`);
    assert(await t.evaluate(() => document.getElementById('cp-submit').disabled === true), '#cp-submit is enabled with nothing selected');
    await pressKey('Enter');
    await until(async () => (await feedback()).includes('Nothing is selected'), 2000, '.cp-feedback says nothing is selected', feedback);
    const attemptAfter = await t.evaluate((i) => window.__orgocraft.state().attemptOf(i), id);
    assert(attemptAfter === attemptBefore, `an empty submit consumed an attempt (${attemptBefore} -> ${attemptAfter})`);
    assert((await text('#challenge-panel .cp-attempts')) === attemptsLine, 'the attempts line changed after an empty submit');
  });

  // 25 ---------------------------------------------------------------------
  await run.step(25, 'T toggles hydrogen blocks and the settings checkbox agrees both ways', async () => {
    await api(() => window.__orgocraft.goToChallenge('ch1-build-methane'));
    await closeDialogs();
    await focusCanvas();
    await until(() => t.evaluate(() => window.__orgocraft.hydrogenMode === 'studs'), 2000, 'hydrogen mode studs');
    await pressKey('KeyT');
    await until(() => t.evaluate(() => window.__orgocraft.hydrogenMode === 'blocks'), 2000, 'hydrogen mode blocks after T');
    await jsClick('#tb-settings');
    await until(() => visible('#st-hydrogens'), 2000, 'settings dialog visible');
    assert(await t.evaluate(() => document.getElementById('st-hydrogens').checked === true), 'the settings checkbox is unchecked after T');
    await closeDialogs();
    await focusCanvas();
    await pressKey('KeyT');
    await until(() => t.evaluate(() => window.__orgocraft.hydrogenMode === 'studs'), 2000, 'hydrogen mode studs after the second T');
    await jsClick('#tb-settings');
    await until(() => visible('#st-hydrogens'), 2000, 'settings dialog visible (2)');
    assert(await t.evaluate(() => document.getElementById('st-hydrogens').checked === false), 'the settings checkbox is checked after the second T');
    await closeDialogs();
    assert(!(await visible('#st-hydrogens')), 'settings dialog did not close');
  });

  // 26 ---------------------------------------------------------------------
  await run.step(26, 'the hover outline follows the crosshair without a scene rebuild', async () => {
    await focusCanvas();
    await api(() => window.__orgocraft.teleport(64.5, 9, 64.5, 0, -0.27));
    await until(() => t.evaluate(() => { const o = window.__orgocraft.hoverOutline(); return o.visible && o.x === 64 && o.y === 9 && o.z === 60; }), 3000, 'outline on the student carbon', () => t.evaluate(() => window.__orgocraft.hoverOutline()));
    const redraws = await t.evaluate(() => window.__orgocraft.redraws);
    await api(() => window.__orgocraft.teleport(64.5, 9, 64.5, 0, -1.4));   // look at the floor by the feet
    await until(() => t.evaluate(() => { const o = window.__orgocraft.hoverOutline(); return o.visible && o.y === 8; }), 3000, 'outline on a floor tile', () => t.evaluate(() => window.__orgocraft.hoverOutline()));
    const after = await t.evaluate(() => window.__orgocraft.redraws);
    assert(after === redraws, `looking around rebuilt the scene (${redraws} -> ${after} redraws)`);
  });

  // 27 ---------------------------------------------------------------------
  await run.step(27, 'rendering pauses while #stage is out of view (IntersectionObserver) and resumes', async () => {
    await t.evaluate(() => { document.getElementById('stage').style.display = 'none'; });
    await sleep(500);
    const f1 = await t.evaluate(() => window.__orgocraft.frames);
    await sleep(500);
    const f2 = await t.evaluate(() => window.__orgocraft.frames);
    assert(f2 === f1, `frames advanced while #stage was hidden (${f1} -> ${f2})`);
    await t.evaluate(() => { document.getElementById('stage').style.display = ''; });
    await until(() => t.evaluate((f) => window.__orgocraft.frames > f + 2, f2), 3000, 'frames advance again once #stage is visible');
  });

  // 18 / 19 (lms) ----------------------------------------------------------
  await run.step(18, 'Save & Exit: confirm, finished overlay, LMSFinish once, exit is not logout', async () => {
    await closeDialogs();
    await focusCanvas();
    await page.keyboard.press('Escape');
    await until(() => visible('#pause'), 2000, '#pause visible');
    await jsClick('#pm-exit');
    await until(() => visible('#dialogs [role="alertdialog"]'), 2000, 'confirm dialog');
    await jsClick('#confirm-ok');
    await until(async () => (await text('#dialogs')).includes('Progress saved'), 5000, 'finished overlay text');
    const rec = await apiRecord();
    const finishes = rec.calls.filter((c) => c[0] === 'LMSFinish').length;
    assert(finishes === 1, `LMSFinish called ${finishes} times`);
    const exits = setsOf(rec, 'cmi.core.exit');
    assert(exits.length > 0 && exits.every((e) => e !== 'logout'), `cmi.core.exit values ${JSON.stringify(exits)}`);
  }, 'lms');

  await run.step(19, 'after Save & Exit the finished overlay has focus and the toast says Progress saved', async () => {
    const r = await t.evaluate(() => {
      const a = document.activeElement;
      return { role: a?.getAttribute('role'), tabindex: a?.getAttribute('tabindex'), toast: document.getElementById('toast')?.textContent ?? '' };
    });
    assert(r.role === 'dialog' && r.tabindex === '-1', `active element is role=${r.role} tabindex=${r.tabindex}`);
    assert(r.toast.includes('Progress saved'), `#toast reads "${r.toast}"`);
  }, 'lms');

  // 15 ---------------------------------------------------------------------
  await run.step(15, 'prefers-reduced-motion: reduce is honoured after a reload', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    let f = page;
    if (mode === 'lms') {
      f = await until(() => page.frame({ name: 'sco' }), 5000, 'sco frame');
      await f.waitForLoadState('load');
    }
    await f.waitForFunction(() => window.__orgocraft?.ready === true && window.__orgocraft.frames > 5, null, { timeout: STEP_TIMEOUT_MS });
    const r = await f.evaluate(() => ({
      flag: document.documentElement.dataset.reducedMotion,
      anims: document.getAnimations().filter((a) => {
        const el = a.effect?.target;
        return el && document.getElementById('stage')?.contains(el);
      }).length,
    }));
    assert(r.flag === 'true', `html[data-reduced-motion] is ${r.flag}`);
    assert(r.anims === 0, `${r.anims} animations running inside #stage`);
  });

  // 21 ---------------------------------------------------------------------
  await run.step(21, 'short frame (1100x580): challenge panel and hotbar never overlap', async () => {
    const ctx2 = await browser.newContext({ viewport: { width: 1100, height: 580 } });
    const p2 = await ctx2.newPage();
    attachErrorCollectors(p2, errors, `${mode}/1100x580`);
    try {
      await p2.goto(mode === 'lms' ? `${baseUrl}/scorm/wrapper.html` : `${baseUrl}${PREFIX}index.html?debug=1`);
      let f = p2;
      if (mode === 'lms') {
        f = await until(() => p2.frame({ name: 'sco' }), 5000, 'sco frame');
        await f.waitForLoadState('load');
      }
      await f.waitForFunction(() => window.__orgocraft?.ready === true && window.__orgocraft.frames > 10 && window.__orgocraft.triangles > 0, null, { timeout: STEP_TIMEOUT_MS });
      assert((await f.evaluate(() => window.__orgocraft.getBlock(64, 8, 64))) === 7, 'LabTile under spawn');
      await f.click('canvas#canvas', { position: { x: 550, y: 290 } });
      assert(await f.evaluate(() => document.activeElement === document.getElementById('canvas')), 'canvas not focused');
      const boxes = () => f.evaluate(() => {
        const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
        return { a: r('challenge-panel'), b: r('hotbar') };
      });
      const disjoint = ({ a, b }) => a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left;
      const setCollapsed = (collapsed) => f.evaluate((c) => {
        const btn = document.querySelector('#challenge-panel .panel-header .collapse');
        if (!btn) return false;
        const isCollapsed = btn.getAttribute('aria-expanded') === 'false';
        if (isCollapsed !== c) btn.click();
        return true;
      }, collapsed);
      assert(await setCollapsed(false), 'no Collapse button in the challenge panel header');
      await sleep(100);
      assert(disjoint(await boxes()), `expanded: boxes intersect ${JSON.stringify(await boxes())}`);
      await setCollapsed(true);
      await sleep(100);
      assert(disjoint(await boxes()), `collapsed: boxes intersect ${JSON.stringify(await boxes())}`);
    } finally {
      await ctx2.close();
    }
  });

  await context.close();
  if (errors.length > 0) {
    run.failures.push(`[${mode}] ${errors.length} console error(s) / uncaught exception(s):\n    ${errors.join('\n    ')}`);
    log(`[${mode}] console errors / uncaught exceptions: ${errors.length}`);
    for (const e of errors) log(`    ${e}`);
  } else {
    log(`[${mode}] zero console errors and zero uncaught exceptions`);
  }
  return run;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const log = (s) => console.log(s);
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('dist/index.html missing - run npm run build first');
    return 1;
  }
  const chrome = findChrome();
  if (!chrome) {
    console.error('no Chromium found: set CHROMIUM_PATH (or CHROME_PATH) to a Chromium binary, or PLAYWRIGHT_BROWSERS_PATH after `npx playwright install chromium`');
    return 1;
  }
  log(`smoke: chromium ${chrome}`);
  const { server, port } = await startServer();
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const screenshotPaths = [join(ROOT, 'test-results/smoke.png'), join(ROOT, 'docs/screenshots/smoke.png')];
  const failures = [];
  let steps = 0;
  try {
    for (const mode of ['standalone', 'lms']) {
      log(`\n=== ${mode} mode: ${mode === 'lms' ? '/scorm/wrapper.html (fake window.API)' : PREFIX + 'index.html?debug=1'} ===`);
      const run = await runScript({ browser, baseUrl, mode, log, screenshotPaths });
      failures.push(...run.failures);
      steps += run.steps;
    }
  } finally {
    await browser.close();
    server.close();
  }
  log('');
  if (failures.length > 0) {
    log(`smoke: ${failures.length} failure(s) in ${steps} steps`);
    for (const f of failures) log(`  - ${f}`);
    return 1;
  }
  log(`smoke: OK (${steps} steps, standalone + lms)`);
  return 0;
}

main().then((code) => process.exit(code), (e) => {
  console.error('smoke: crashed', e);
  process.exit(1);
});
