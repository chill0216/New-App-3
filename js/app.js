// Main application: camera, face tracking, UI wiring and the render loop.

import { Renderer } from './renderer.js';
import { TABS, DEFORMATIONS, BODY_FAT, ALL_SLIDER_IDS, faceFrame, applyDeformations } from './deformations.js';
import { LANDMARK_COUNT } from './mesh-data.js';
import { composeBeforeAfter, canvasToBlob, canShareFiles, shareFile, downloadBlob } from './capture.js';

// Where the MediaPipe runtime and model come from. A host page can self-host them by
// defining window.FACE_SCULPT_ASSETS = { bundle, wasm, model } before this module runs.
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1';
const ASSETS = {
  bundle: `${CDN}/vision_bundle.mjs`,
  wasm: `${CDN}/wasm`,
  model: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  ...(window.FACE_SCULPT_ASSETS || {}),
};

const $ = (sel) => document.querySelector(sel);

const els = {
  intro: $('#intro'),
  startBtn: $('#startBtn'),
  introStatus: $('#introStatus'),
  stage: $('#stage'),
  canvas: $('#view'),
  video: $('#cam'),
  status: $('#status'),
  turnHint: $('#turnHint'),
  turnBar: $('#turnBar'),
  holdBtn: $('#holdBtn'),
  shutterBtn: $('#shutterBtn'),
  viewToggle: $('#viewToggle'),
  tabs: $('#tabs'),
  sliders: $('#sliders'),
  bodyFat: $('#bodyFat'),
  bodyFatValue: $('#bodyFatValue'),
  resetBtn: $('#resetBtn'),
  result: $('#result'),
  resultImg: $('#resultImg'),
  saveBtn: $('#saveBtn'),
  shareBtn: $('#shareBtn'),
  closeResultBtn: $('#closeResultBtn'),
};

const state = {
  values: Object.fromEntries(ALL_SLIDER_IDS.map((id) => [id, 0])),
  tab: TABS[0].id,
  mode: 'front',
  holdOriginal: false,
  landmarker: null,
  renderer: null,
  running: false,
  lastVideoTime: -1,
  base: new Float32Array(LANDMARK_COUNT * 3),
  warped: new Float32Array(LANDMARK_COUNT * 2),
  haveFace: false,
  frame: null,
  matrix: null,
  lastFaceAt: 0,
  resultBlob: null,
  fpsAcc: 0,
  fpsCount: 0,
  fpsAt: 0,
  fps: 0,
};

// ---------------------------------------------------------------- UI

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = `pill status ${kind}`.trim();
  els.status.hidden = !text;
}

function fmt(v) {
  return v > 0 ? `+${v}` : `${v}`;
}

function buildTabs() {
  els.tabs.innerHTML = '';
  for (const t of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.textContent = t.label;
    b.dataset.tab = t.id;
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      state.tab = t.id;
      renderTabs();
      buildSliders();
    });
    els.tabs.appendChild(b);
  }
  renderTabs();
}

function renderTabs() {
  for (const b of els.tabs.children) {
    const active = b.dataset.tab === state.tab;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  }
}

function buildSliders() {
  els.sliders.innerHTML = '';
  for (const d of DEFORMATIONS.filter((x) => x.tab === state.tab)) {
    const row = document.createElement('label');
    row.className = 'slider';
    row.innerHTML = `
      <span class="slider-head"><span class="name"></span><span class="value"></span></span>
      <input type="range" min="-100" max="100" step="1">`;
    row.querySelector('.name').textContent = d.label;
    const input = row.querySelector('input');
    const value = row.querySelector('.value');
    input.value = Math.round(state.values[d.id] * 100);
    value.textContent = fmt(+input.value);
    input.addEventListener('input', () => {
      state.values[d.id] = +input.value / 100;
      value.textContent = fmt(+input.value);
    });
    // Double-tap the name to zero a single slider.
    row.querySelector('.name').addEventListener('dblclick', () => {
      input.value = 0;
      state.values[d.id] = 0;
      value.textContent = fmt(0);
    });
    els.sliders.appendChild(row);
  }
}

function bindControls() {
  els.bodyFat.addEventListener('input', () => {
    state.values[BODY_FAT.id] = +els.bodyFat.value / 100;
    els.bodyFatValue.textContent = fmt(+els.bodyFat.value);
  });

  els.resetBtn.addEventListener('click', () => {
    for (const id of ALL_SLIDER_IDS) state.values[id] = 0;
    els.bodyFat.value = 0;
    els.bodyFatValue.textContent = fmt(0);
    buildSliders();
  });

  // Press and hold to see the unedited face.
  const hold = (on) => {
    state.holdOriginal = on;
    els.holdBtn.classList.toggle('active', on);
    els.holdBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  els.holdBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    els.holdBtn.setPointerCapture?.(e.pointerId);
    hold(true);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    els.holdBtn.addEventListener(ev, () => hold(false));
  }
  els.holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  els.holdBtn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); hold(true); } });
  els.holdBtn.addEventListener('keyup', () => hold(false));

  els.viewToggle.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    state.mode = b.dataset.mode;
    for (const x of els.viewToggle.querySelectorAll('button')) {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
    }
    els.turnHint.hidden = state.mode !== 'side';
  });

  els.shutterBtn.addEventListener('click', capture);
  els.closeResultBtn.addEventListener('click', closeResult);
  els.saveBtn.addEventListener('click', () => {
    if (state.resultBlob) downloadBlob(state.resultBlob, `face-edit-${Date.now()}.jpg`);
  });
  els.shareBtn.addEventListener('click', async () => {
    if (!state.resultBlob) return;
    const file = new File([state.resultBlob], 'before-after.jpg', { type: 'image/jpeg' });
    try {
      await shareFile(file);
    } catch (err) {
      if (err && err.name !== 'AbortError') setStatus('Sharing failed', 'warn');
    }
  });
}

// ---------------------------------------------------------------- camera + model

async function loadLandmarker() {
  const { FilesetResolver, FaceLandmarker } = await import(ASSETS.bundle);
  const vision = await FilesetResolver.forVisionTasks(ASSETS.wasm);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: ASSETS.model, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
    outputFaceBlendshapes: false,
  });
  try {
    return await FaceLandmarker.createFromOptions(vision, options('GPU'));
  } catch (err) {
    console.warn('GPU delegate unavailable, using CPU', err);
    return FaceLandmarker.createFromOptions(vision, options('CPU'));
  }
}

async function openCamera() {
  const constraints = {
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  els.video.srcObject = stream;
  await new Promise((resolve) => {
    if (els.video.readyState >= 1) resolve();
    else els.video.onloadedmetadata = () => resolve();
  });
  await els.video.play();
}

async function start() {
  els.startBtn.disabled = true;
  els.introStatus.textContent = 'Starting camera…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot access the camera');
    state.renderer = new Renderer(els.canvas);
    const modelPromise = state.landmarkerPromise || loadLandmarker();
    await openCamera();
    els.introStatus.textContent = 'Loading face model…';
    state.landmarker = await modelPromise;
  } catch (err) {
    console.error(err);
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    els.introStatus.textContent = denied
      ? 'Camera access was blocked. Allow the camera for this site and reload.'
      : `Could not start: ${err.message || err}`;
    els.startBtn.disabled = false;
    return;
  }
  els.intro.hidden = true;
  state.running = true;
  setStatus('Show your face', '');
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- render loop

function track(now) {
  const video = els.video;
  if (video.currentTime === state.lastVideoTime) return;
  state.lastVideoTime = video.currentTime;
  const res = state.landmarker.detectForVideo(video, now);
  const lm = res.faceLandmarks && res.faceLandmarks[0];
  if (lm && lm.length >= LANDMARK_COUNT) {
    const W = video.videoWidth;
    const H = video.videoHeight;
    const b = state.base;
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      b[i * 3] = lm[i].x * W;
      b[i * 3 + 1] = lm[i].y * H;
      b[i * 3 + 2] = lm[i].z * W;
    }
    state.matrix = res.facialTransformationMatrixes?.[0]?.data || null;
    state.frame = faceFrame(b, state.matrix);
    state.haveFace = true;
    state.lastFaceAt = now;
  } else if (now - state.lastFaceAt > 300) {
    state.haveFace = false;
  }
}

/** Render the current frame. Pass `edited=false` to draw the untouched camera image. */
function render(edited) {
  const r = state.renderer;
  if (edited && state.haveFace) {
    applyDeformations(state.base, state.frame, state.values, state.mode, state.warped);
    r.draw(state.base, state.warped, state.frame);
  } else {
    r.draw(null, null, null);
  }
}

function updateHints(now) {
  if (!state.haveFace) {
    setStatus('No face detected — look at the camera', 'warn');
  } else if (els.status.classList.contains('warn') || els.status.textContent === 'Show your face') {
    setStatus('');
  }
  if (state.mode === 'side') {
    const turn = state.haveFace ? Math.min(1, Math.abs(state.frame.fx) / 0.5) : 0;
    els.turnBar.style.width = `${Math.round(turn * 100)}%`;
    els.turnHint.classList.toggle('ok', turn >= 0.8);
    els.turnHint.querySelector('.text').textContent = turn >= 0.8
      ? 'Side view ready'
      : 'Turn your head about 45°';
  }
  // Lightweight FPS meter for the status pill in the console (debugging aid).
  state.fpsCount++;
  if (now - state.fpsAt > 1000) {
    state.fps = state.fpsCount;
    state.fpsCount = 0;
    state.fpsAt = now;
  }
}

function loop(now) {
  if (!state.running) return;
  const video = els.video;
  if (video.videoWidth && video.videoHeight) {
    state.renderer.resize(video.videoWidth, video.videoHeight);
    try {
      track(now);
    } catch (err) {
      console.error(err);
    }
    state.renderer.uploadFrame(video);
    render(!state.holdOriginal);
    updateHints(now);
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- capture

function snapshot() {
  const c = document.createElement('canvas');
  c.width = els.canvas.width;
  c.height = els.canvas.height;
  c.getContext('2d').drawImage(els.canvas, 0, 0);
  return c;
}

async function capture() {
  if (!state.running) return;
  if (!state.haveFace) {
    setStatus('No face to capture', 'warn');
    return;
  }
  // Draw both versions of the same frame synchronously so nothing changes between them.
  state.renderer.uploadFrame(els.video);
  render(false);
  const before = snapshot();
  render(true);
  const after = snapshot();
  const composed = composeBeforeAfter(before, after);
  try {
    state.resultBlob = await canvasToBlob(composed);
  } catch (err) {
    setStatus('Could not create image', 'warn');
    return;
  }
  const url = URL.createObjectURL(state.resultBlob);
  els.resultImg.src = url;
  els.result.hidden = false;
  const file = new File([state.resultBlob], 'before-after.jpg', { type: 'image/jpeg' });
  els.shareBtn.hidden = !canShareFiles(file);
  els.stage.classList.add('flash');
  setTimeout(() => els.stage.classList.remove('flash'), 250);
}

function closeResult() {
  els.result.hidden = true;
  if (els.resultImg.src) URL.revokeObjectURL(els.resultImg.src);
  els.resultImg.removeAttribute('src');
  state.resultBlob = null;
}

// ---------------------------------------------------------------- boot

function boot() {
  buildTabs();
  buildSliders();
  bindControls();
  els.turnHint.hidden = true;
  if (!window.isSecureContext) {
    els.introStatus.textContent = 'Camera access needs HTTPS (or localhost).';
  }
  // Start fetching the model while the user reads the intro.
  state.landmarkerPromise = loadLandmarker().catch((err) => {
    console.error(err);
    state.landmarkerPromise = null;
    throw err;
  });
  els.startBtn.addEventListener('click', start);
  window.__faceSculpt = state; // debugging / test hook
}

boot();
