/**
 * Entry point: marks the stage as framed or top-level, starts the Game and
 * shows the no-WebGL / fatal-error message when it cannot start.
 * docs/design/06-engine.md §11.1, §11.4; 07-ui.md §2.1, §2.2.
 */
import { Game } from './app/Game';
import { STRINGS } from './ui/strings';

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Shows the fatal message region (the #no-webgl alert of 07 §2.1) and hides the stage. */
function fatal(message: string, detail?: unknown): void {
  const box = byId<HTMLElement>('no-webgl');
  const stage = byId<HTMLElement>('stage');
  if (box) {
    box.textContent = message;
    box.removeAttribute('hidden');
  }
  if (stage) stage.setAttribute('hidden', '');
  if (detail !== undefined) console.error('[orgocraft]', message, detail);
  else console.error('[orgocraft]', message);
}

function hasWebgl(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch {
    return false;
  }
}

function boot(): void {
  const stage = byId<HTMLElement>('stage');
  const canvas = byId<HTMLCanvasElement>('canvas');
  if (!stage || !canvas) {
    fatal('OrgoCraft could not start: the page is missing its stage or canvas element.');
    return;
  }
  let framed = false;
  try {
    framed = window.self !== window.top;
  } catch {
    framed = true;
  }
  stage.dataset['framed'] = framed ? 'true' : 'false';
  if (!canvas.getAttribute('aria-label')) canvas.setAttribute('aria-label', STRINGS.canvasLabel);
  if (!hasWebgl()) {
    fatal(STRINGS.noWebgl);
    return;
  }
  const debug = new URLSearchParams(location.search).get('debug') === '1';
  let game: Game;
  try {
    game = new Game({ stage, canvas, debug });
  } catch (e) {
    fatal(STRINGS.noWebgl, e);
    return;
  }
  try {
    game.start();
  } catch (e) {
    fatal('OrgoCraft could not start. Reload the page; if this keeps happening, try another browser.', e);
    game.dispose();
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
