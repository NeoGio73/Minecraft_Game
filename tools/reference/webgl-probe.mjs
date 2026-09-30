import { chromium } from '/home/user/Minecraft_Game/node_modules/playwright-core/index.mjs';
const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
for (const args of [[], ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']]) {
  let browser;
  try {
    browser = await chromium.launch({ executablePath: exe, headless: true, args });
    const page = await browser.newPage();
    await page.setContent('<canvas id=c width=64 height=64></canvas>');
    const r = await page.evaluate(() => {
      const c = document.getElementById('c');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return { ok: false };
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return { ok: true, ver: gl.getParameter(gl.VERSION), renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), gpu: !!navigator.gpu, ua: navigator.userAgent };
    });
    console.log(JSON.stringify({ args, ...r }));
  } catch (e) { console.log('launch failed', args, String(e).slice(0, 300)); }
  finally { await browser?.close(); }
}
