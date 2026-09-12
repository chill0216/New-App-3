// Headless smoke test for the live pipeline.
//
// 1. Serves the repo over HTTP.
// 2. Turns a still face image into a Y4M clip and feeds it to Chromium's fake webcam.
// 3. Opens the app, starts the camera, waits for a face, moves sliders and captures.
// 4. Asserts that the warp changes pixels, that "hold original" restores them, and
//    that the shutter produces a before/after image.
//
// Env:
//   FACE_IMAGE=path/to/face.jpg   use a local portrait instead of downloading one
//   HEADED=1                      show the browser
//
// If `@mediapipe/tasks-vision` is installed locally and/or the model is cached under
// test/cache, the CDN requests are served from disk so the test works offline.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'test', 'cache');
const OUT = path.join(ROOT, 'test', 'output');
const SAMPLE_FACE_URL = 'https://storage.googleapis.com/mediapipe-assets/portrait.jpg';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const CDN_PREFIX = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@';
const MP_DIR = path.join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };

function serve(dir) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(dir, decodeURIComponent(url.pathname));
    if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = path.join(file, 'index.html');
    } catch { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

const assert = (cond, msg) => { if (!cond) throw new Error(`Assertion failed: ${msg}`); };

function launchArgs(extra = []) {
  return ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...extra];
}

// Only used for the one-off sample download; the app browser talks to localhost.
function proxyOption() {
  const p = process.env.HTTPS_PROXY || process.env.https_proxy;
  return p ? { proxy: { server: p } } : {};
}

async function routeLocalAssets(page) {
  if (existsSync(MP_DIR)) {
    await page.route((u) => u.href.startsWith(CDN_PREFIX), async (route) => {
      const rel = route.request().url().slice(CDN_PREFIX.length).replace(/^[^/]+\//, '');
      const file = path.join(MP_DIR, rel);
      if (!existsSync(file)) return route.abort();
      return route.fulfill({ body: await readFile(file), contentType: MIME[path.extname(file)] || 'application/octet-stream' });
    });
  }
  const model = path.join(CACHE, 'face_landmarker.task');
  if (existsSync(model)) {
    await page.route(MODEL_URL, async (route) => route.fulfill({ body: await readFile(model), contentType: 'application/octet-stream' }));
  }
}

/** Convert RGBA pixels to a two-frame Y4M clip (I420). */
function rgbaToY4m(rgba, w, h) {
  const ySize = w * h;
  const cSize = (w / 2) * (h / 2);
  const y = Buffer.alloc(ySize);
  const u = Buffer.alloc(cSize);
  const v = Buffer.alloc(cSize);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 4;
      const r = rgba[o]; const g = rgba[o + 1]; const b = rgba[o + 2];
      y[j * w + i] = Math.max(16, Math.min(235, Math.round(0.257 * r + 0.504 * g + 0.098 * b + 16)));
      if ((i & 1) === 0 && (j & 1) === 0) {
        const c = (j / 2) * (w / 2) + i / 2;
        u[c] = Math.max(16, Math.min(240, Math.round(-0.148 * r - 0.291 * g + 0.439 * b + 128)));
        v[c] = Math.max(16, Math.min(240, Math.round(0.439 * r - 0.368 * g - 0.071 * b + 128)));
      }
    }
  }
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, u, v]);
  return Buffer.concat([header, frame, frame]);
}

async function prepareClip() {
  await mkdir(CACHE, { recursive: true });
  const clip = path.join(CACHE, 'face.y4m');
  let imageBytes;
  const local = process.env.FACE_IMAGE || path.join(CACHE, 'face.jpg');
  if (existsSync(local)) {
    imageBytes = await readFile(local);
  } else {
    console.log('Downloading sample portrait…');
    const browser = await chromium.launch({ ...proxyOption() });
    const resp = await browser.request.get(SAMPLE_FACE_URL);
    assert(resp.ok(), `download sample portrait (${resp.status()})`);
    imageBytes = Buffer.from(await resp.body());
    await writeFile(path.join(CACHE, 'face.jpg'), imageBytes);
    await browser.close();
  }
  // Decode with the browser so the test has no native image dependencies.
  const browser = await chromium.launch({ args: launchArgs() });
  const page = await browser.newPage();
  const dataUrl = `data:image/jpeg;base64,${imageBytes.toString('base64')}`;
  const { w, h, rgba } = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = Math.min(1, 720 / Math.max(img.width, img.height));
    const w = Math.floor((img.width * scale) / 2) * 2;
    const h = Math.floor((img.height * scale) / 2) * 2;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return { w, h, rgba: Array.from(ctx.getImageData(0, 0, w, h).data) };
  }, dataUrl);
  await browser.close();
  await writeFile(clip, rgbaToY4m(Uint8Array.from(rgba), w, h));
  console.log(`Clip ${w}x${h} written`);
  return clip;
}

async function setSlider(page, id, value) {
  await page.evaluate(({ id, value }) => {
    const s = window.__faceSculpt;
    s.values[id] = value;
    // Mirror into the visible control when it is on screen.
    const input = document.getElementById(id === 'bodyFat' ? 'bodyFat' : '');
    if (input) input.value = Math.round(value * 100);
  }, { id, value });
}

async function canvasPixels(page) {
  return page.evaluate(() => {
    const src = document.getElementById('view');
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
  });
}

function meanAbsDiff(a, b) {
  let sum = 0; let n = 0;
  for (let i = 0; i < a.length; i += 4) { sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3; }
  return sum / n;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const clip = await prepareClip();
  const { server, port } = await serve(ROOT);
  const browser = await chromium.launch({
    headless: !process.env.HEADED,
    args: launchArgs([
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${clip}`,
    ]),
  });
  const context = await browser.newContext({ viewport: { width: 420, height: 860 }, permissions: ['camera'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await routeLocalAssets(page);

  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.click('#startBtn');
    await page.waitForSelector('#intro', { state: 'hidden', timeout: 120000 });
    console.log('Camera started');
    await page.waitForFunction(() => window.__faceSculpt?.haveFace === true, null, { timeout: 60000 });
    console.log('Face detected');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, '01-live.png') });

    const frame = await page.evaluate(() => ({ ...window.__faceSculpt.frame }));
    assert(Number.isFinite(frame.scale) && frame.scale > 50, `face scale sane (${frame.scale})`);
    console.log(`Face frame: scale=${frame.scale.toFixed(1)} yaw=${frame.fx.toFixed(3)}`);

    const original = await canvasPixels(page);

    // Strong lateral edits should be clearly visible head-on.
    await setSlider(page, 'jawWidth', 1);
    await setSlider(page, 'cheekbones', 1);
    await setSlider(page, 'eyeSize', 1);
    await setSlider(page, 'noseWidth', -1);
    await setSlider(page, 'bodyFat', -1);
    await page.waitForTimeout(300);
    const edited = await canvasPixels(page);
    await page.screenshot({ path: path.join(OUT, '02-edited.png') });
    const d1 = meanAbsDiff(original, edited);
    console.log(`Mean pixel change after edits: ${d1.toFixed(3)}`);
    assert(d1 > 0.5, 'edits change the rendered image');

    // Holding the button restores the original.
    await page.dispatchEvent('#holdBtn', 'pointerdown', { pointerId: 1 });
    await page.waitForTimeout(200);
    const held = await canvasPixels(page);
    await page.dispatchEvent('#holdBtn', 'pointerup', { pointerId: 1 });
    const d2 = meanAbsDiff(original, held);
    console.log(`Mean pixel change while holding original: ${d2.toFixed(3)}`);
    assert(d2 < 0.05, 'hold shows the unedited face');

    // Side mode: projection sliders should do little on a frontal face.
    await page.click('#viewToggle button[data-mode="side"]');
    await page.waitForSelector('#turnHint', { state: 'visible' });
    for (const id of ['jawWidth', 'cheekbones', 'eyeSize', 'noseWidth', 'bodyFat']) await setSlider(page, id, 0);
    await setSlider(page, 'chinProjection', 1);
    await setSlider(page, 'noseBridge', 1);
    await page.waitForTimeout(300);
    const proj = await canvasPixels(page);
    const d3 = meanAbsDiff(original, proj);
    console.log(`Mean pixel change from projection sliders head-on: ${d3.toFixed(3)}`);
    assert(d3 < d1, 'projection edits are subtler head-on than lateral edits');
    await page.click('#viewToggle button[data-mode="front"]');

    // Every slider at both extremes must render without errors or NaNs.
    const ids = await page.evaluate(() => Object.keys(window.__faceSculpt.values));
    for (const id of ids) {
      for (const v of [-1, 1]) {
        await setSlider(page, id, v);
        await page.waitForTimeout(60);
        const bad = await page.evaluate(() => [...window.__faceSculpt.warped, ...window.__faceSculpt.shade].some((x) => !Number.isFinite(x)));
        assert(!bad, `${id}=${v} produced finite positions`);
        await setSlider(page, id, 0);
      }
    }
    console.log(`All ${ids.length} sliders render at both extremes`);

    // Shutter → before/after image.
    await setSlider(page, 'jawAngle', 1);
    await setSlider(page, 'canthalTilt', 1);
    await setSlider(page, 'lipFullness', 1);
    await page.waitForTimeout(200);
    await page.click('#shutterBtn');
    await page.waitForSelector('#result', { state: 'visible', timeout: 10000 });
    const img = await page.$eval('#resultImg', (el) => ({ w: el.naturalWidth, h: el.naturalHeight, src: el.src }));
    assert(img.src.startsWith('blob:') && img.w > 0, 'result image is populated');
    console.log(`Before/after image: ${img.w}x${img.h}`);
    await page.screenshot({ path: path.join(OUT, '03-result.png') });
    const bytes = await page.evaluate(async () => {
      const b = await fetch(document.getElementById('resultImg').src).then((r) => r.arrayBuffer());
      return Array.from(new Uint8Array(b));
    });
    await writeFile(path.join(OUT, 'before-after.jpg'), Buffer.from(bytes));
    await page.click('#closeResultBtn');
    await page.waitForSelector('#result', { state: 'hidden' });

    const fps = await page.evaluate(() => window.__faceSculpt.fps);
    console.log(`Loop rate: ~${fps} fps (software GL)`);
    const real = errors.filter((e) => !/^INFO:|GPU stall|swiftshader|WebGL: /i.test(e));
    assert(real.length === 0, `no page errors: ${real.join(' | ')}`);
    console.log('PASS');
  } catch (err) {
    if (errors.length) console.error('Page errors:\n' + errors.join('\n'));
    throw err;
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
