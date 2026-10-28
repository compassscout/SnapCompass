/* SnapCompass editor — canvas based screenshot annotation */

const stage = document.getElementById('stage');
const ctx = stage.getContext('2d');
const wrap = document.getElementById('wrap');
const cropLayer = document.getElementById('cropLayer');
const textInput = document.getElementById('textInput');
const emptyState = document.getElementById('emptyState');

const COLORS = ['#ff3b5c', '#ffb020', '#22c55e', '#3b82f6', '#a855f7', '#ffffff', '#111827', '#000000'];

const state = {
  base: null,          // canvas holding the screenshot (or blank sheet)
  baseDpr: 1,          // device pixel ratio of the screenshot
  shapes: [],
  tool: 'select',
  color: '#ff3b5c',
  size: 4,
  fontSize: 24,
  zoom: 1,
  dirty: false
};

/* ------------------------------------------------------------------ setup */

function initSwatches() {
  const box = document.getElementById('swatches');
  COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.style.background = c;
    if (c === state.color) b.classList.add('on');
    b.addEventListener('click', () => {
      state.color = c;
      document.getElementById('color').value = c;
      box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    });
    box.appendChild(b);
  });
}

function dimsLabel() {
  if (!state.base) return '';
  const d = state.baseDpr || 1;
  document.getElementById('dims').textContent =
    `${Math.round(state.base.width / d)} × ${Math.round(state.base.height / d)} px`;
}

function displayScale() {
  return state.zoom / (state.baseDpr || 1);
}

function layout() {
  if (!state.base) return;
  const s = displayScale();
  stage.width = state.base.width;
  stage.height = state.base.height;
  stage.style.width = Math.round(state.base.width * s) + 'px';
  stage.style.height = Math.round(state.base.height * s) + 'px';
  document.getElementById('zoomLabel').textContent = Math.round(state.zoom * 100) + '%';
  render();
  dimsLabel();
}

/* ---------------------------------------------------------------- drawing */

function drawShape(c, sh) {
  c.save();
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = sh.color;
  c.fillStyle = sh.color;
  c.lineWidth = sh.size;

  switch (sh.type) {
    case 'pen': {
      if (!sh.points.length) break;
      c.beginPath();
      c.moveTo(sh.points[0].x, sh.points[0].y);
      for (let i = 1; i < sh.points.length; i++) c.lineTo(sh.points[i].x, sh.points[i].y);
      c.stroke();
      break;
    }
    case 'line': {
      c.beginPath();
      c.moveTo(sh.x1, sh.y1);
      c.lineTo(sh.x2, sh.y2);
      c.stroke();
      break;
    }
    case 'arrow': {
      const dx = sh.x2 - sh.x1, dy = sh.y2 - sh.y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const head = Math.max(12 * (state.baseDpr || 1), sh.size * 4.2);
      const bx = sh.x2 - ux * head, by = sh.y2 - uy * head;
      c.beginPath();
      c.moveTo(sh.x1, sh.y1);
      c.lineTo(bx, by);
      c.stroke();
      c.beginPath();
      c.moveTo(sh.x2, sh.y2);
      c.lineTo(bx - uy * head * 0.55, by + ux * head * 0.55);
      c.lineTo(bx + uy * head * 0.55, by - ux * head * 0.55);
      c.closePath();
      c.fill();
      break;
    }
    case 'rect': {
      c.strokeRect(sh.x, sh.y, sh.w, sh.h);
      break;
    }
    case 'ellipse': {
      c.beginPath();
      c.ellipse(sh.x + sh.w / 2, sh.y + sh.h / 2, Math.abs(sh.w / 2), Math.abs(sh.h / 2), 0, 0, Math.PI * 2);
      c.stroke();
      break;
    }
    case 'text': {
      c.font = `600 ${sh.fontSize}px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif`;
      c.textBaseline = 'top';
      sh.text.split('\n').forEach((line, i) => {
        c.fillText(line, sh.x, sh.y + i * sh.fontSize * 1.25);
      });
      break;
    }
    case 'mosaic': {
      const px = Math.max(6, sh.size * 3);
      const sx = Math.max(0, sh.x), sy = Math.max(0, sh.y);
      const sw = Math.min(sh.w, state.base.width - sx);
      const shh = Math.min(sh.h, state.base.height - sy);
      if (sw <= 1 || shh <= 1) break;
      const tiny = document.createElement('canvas');
      tiny.width = Math.max(1, Math.round(sw / px));
      tiny.height = Math.max(1, Math.round(shh / px));
      const tctx = tiny.getContext('2d');
      tctx.drawImage(state.base, sx, sy, sw, shh, 0, 0, tiny.width, tiny.height);
      c.imageSmoothingEnabled = false;
      c.drawImage(tiny, 0, 0, tiny.width, tiny.height, sx, sy, sw, shh);
      c.imageSmoothingEnabled = true;
      break;
    }
  }
  c.restore();
}

function render() {
  if (!state.base) return;
  ctx.clearRect(0, 0, stage.width, stage.height);
  ctx.drawImage(state.base, 0, 0);
  for (const sh of state.shapes) drawShape(ctx, sh);
  if (previewShape) drawShape(ctx, previewShape);
  cropLayer.hidden = !(state.tool === 'crop' && cropRect);
  if (state.tool === 'crop' && cropRect) {
    const s = displayScale();
    const rect = stage.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    cropLayer.style.left = (rect.left - wrapRect.left + cropRect.x * s) + 'px';
    cropLayer.style.top = (rect.top - wrapRect.top + cropRect.y * s) + 'px';
    cropLayer.style.width = Math.abs(cropRect.w * s) + 'px';
    cropLayer.style.height = Math.abs(cropRect.h * s) + 'px';
  }
}

/* --------------------------------------------------------------- loading */

function makeBaseFromImage(img, crop) {
  const dpr = state.baseDpr;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (crop) {
    sx = Math.round(crop.x * dpr);
    sy = Math.round(crop.y * dpr);
    sw = Math.max(1, Math.round(crop.w * dpr));
    sh = Math.max(1, Math.round(crop.h * dpr));
  }
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = src;
  });
}

function stitchTiles(shot) {
  const dpr = shot.dpr || 1;
  const MAX_H = 32000;
  const rawH = Math.round((shot.totalH || shot.viewportH) * dpr);
  const scale = rawH > MAX_H ? MAX_H / rawH : 1;
  const W = Math.round((shot.viewportW || 1280) * dpr * scale);
  const H = Math.min(MAX_H, rawH);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, W);
  canvas.height = Math.max(1, H);
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, W, H);
  return Promise.all(shot.tiles.map((t) => loadImage(t.dataUrl))).then((imgs) => {
    let drawn = 0;
    shot.tiles.forEach((tile, i) => {
      const img = imgs[i];
      const destY = Math.round((tile.scrollY || 0) * dpr * scale);
      if (destY >= H) return;
      const startY = Math.max(0, drawn - destY);
      const hCanvas = Math.min(img.height * scale - startY, H - destY);
      if (hCanvas <= 1) return;
      c.drawImage(
        img,
        0, startY / scale, img.width, hCanvas / scale,
        0, destY + startY, W, hCanvas
      );
      drawn = Math.max(drawn, destY + startY + hCanvas);
    });
    return canvas;
  });
}

async function init() {
  initSwatches();

  // Desktop: expose loadScreenshot(dataUrl, dpr) for the host app (app.js)
  window.loadScreenshot = async (dataUrl, dpr) => {
    const img = await loadImage(dataUrl);
    state.baseDpr = dpr || 1;
    state.base = makeBaseFromImage(img, null);
    state.shapes = [];
    previewShape = null;
    cropRect = null;
    cropStart = null;
    document.getElementById('pageTitle').textContent = '';
    emptyState.hidden = true;
    state.zoom = 1;
    layout();
    fitIfLarge();
    return true;
  };

  // blank editor until a screenshot arrives
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 800;
  const cc = c.getContext('2d');
  cc.fillStyle = '#ffffff';
  cc.fillRect(0, 0, c.width, c.height);
  state.baseDpr = window.devicePixelRatio || 1;
  state.base = c;

  state.zoom = 1;
  layout();
  fitIfLarge();
}

function fitIfLarge() {
  if (!state.base) return;
  const availW = wrap.clientWidth - 56;
  const availH = wrap.clientHeight - 56;
  const cssW = state.base.width / (state.baseDpr || 1);
  const cssH = state.base.height / (state.baseDpr || 1);
  const z = Math.min(1, availW / cssW, availH / cssH);
  state.zoom = Math.max(0.05, Math.min(1, z));
  layout();
}

/* ------------------------------------------------------------- pointer IO */

let drawing = false;
let start = null;
let previewShape = null;
let cropRect = null;
let cropStart = null;

function toCanvas(e) {
  const rect = stage.getBoundingClientRect();
  const s = displayScale();
  return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s };
}

function beginShape(tool, p) {
  const common = { color: state.color, size: state.size * (state.baseDpr || 1) };
  switch (tool) {
    case 'pen': return { type: 'pen', points: [p], ...common };
    case 'line': return { type: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y, ...common };
    case 'arrow': return { type: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y, ...common };
    case 'rect': return { type: 'rect', x: p.x, y: p.y, w: 0, h: 0, ...common };
    case 'ellipse': return { type: 'ellipse', x: p.x, y: p.y, w: 0, h: 0, ...common };
    case 'mosaic': return { type: 'mosaic', x: p.x, y: p.y, w: 0, h: 0, ...common };
    default: return null;
  }
}

function updateShape(sh, p) {
  switch (sh.type) {
    case 'pen': sh.points.push(p); break;
    case 'line':
    case 'arrow': sh.x2 = p.x; sh.y2 = p.y; break;
    case 'rect':
    case 'ellipse':
    case 'mosaic':
      sh.x = Math.min(start.x, p.x);
      sh.y = Math.min(start.y, p.y);
      sh.w = Math.abs(p.x - start.x);
      sh.h = Math.abs(p.y - start.y);
      break;
  }
}

stage.addEventListener('mousedown', (e) => {
  if (!state.base) return;
  const p = toCanvas(e);
  if (state.tool === 'text') {
    openTextInput(e, p);
    return;
  }
  if (state.tool === 'crop') {
    cropStart = p;
    cropRect = { x: p.x, y: p.y, w: 0, h: 0 };
    drawing = true;
    render();
    return;
  }
  if (state.tool === 'select') {
    drawing = true;
    start = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
    return;
  }
  drawing = true;
  start = p;
  previewShape = beginShape(state.tool, p);
  render();
});

window.addEventListener('mousemove', (e) => {
  if (!drawing) return;
  if (state.tool === 'select' && start) {
    wrap.scrollLeft = start.sl - (e.clientX - start.x);
    wrap.scrollTop = start.st - (e.clientY - start.y);
    return;
  }
  const p = toCanvas(e);
  if (state.tool === 'crop' && cropStart) {
    cropRect = {
      x: Math.min(cropStart.x, p.x),
      y: Math.min(cropStart.y, p.y),
      w: Math.abs(p.x - cropStart.x),
      h: Math.abs(p.y - cropStart.y)
    };
    render();
    return;
  }
  if (previewShape) {
    updateShape(previewShape, p);
    render();
  }
});

window.addEventListener('mouseup', (e) => {
  if (!drawing) return;
  drawing = false;
  if (state.tool === 'select') { start = null; return; }
  if (state.tool === 'crop' && cropRect) {
    if (cropRect.w > 6 && cropRect.h > 6) {
      const c = document.createElement('canvas');
      c.width = Math.round(cropRect.w);
      c.height = Math.round(cropRect.h);
      c.getContext('2d').drawImage(
        state.base,
        Math.round(cropRect.x), Math.round(cropRect.y), Math.round(cropRect.w), Math.round(cropRect.h),
        0, 0, Math.round(cropRect.w), Math.round(cropRect.h)
      );
      state.base = c;
      state.shapes = [];
    }
    cropRect = null;
    cropStart = null;
    layout();
    return;
  }
  if (previewShape) {
    const sh = previewShape;
    previewShape = null;
    const tooSmall =
      (sh.type === 'rect' || sh.type === 'ellipse' || sh.type === 'mosaic') && (sh.w < 4 || sh.h < 4);
    const isDot = (sh.type === 'line' || sh.type === 'arrow') && Math.hypot(sh.x2 - sh.x1, sh.y2 - sh.y1) < 6;
    if (!tooSmall && !isDot) {
      state.shapes.push(sh);
      state.dirty = true;
    }
    render();
  }
});

function openTextInput(e, p) {
  const rect = stage.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  textInput.hidden = false;
  textInput.style.left = (rect.left - wrapRect.left + p.x * displayScale() + wrap.scrollLeft) + 'px';
  textInput.style.top = (rect.top - wrapRect.top + p.y * displayScale() + wrap.scrollTop) + 'px';
  textInput.value = '';
  textInput.dataset.x = p.x;
  textInput.dataset.y = p.y;
  textInput.style.fontSize = Math.max(12, state.fontSize * displayScale()) + 'px';
  requestAnimationFrame(() => textInput.focus());
}

function commitText() {
  if (textInput.hidden) return;
  const text = textInput.value.trim();
  const x = parseFloat(textInput.dataset.x);
  const y = parseFloat(textInput.dataset.y);
  textInput.hidden = true;
  if (!text) return;
  state.shapes.push({
    type: 'text',
    x, y,
    text,
    color: state.color,
    size: state.size,
    fontSize: state.fontSize * (state.baseDpr || 1)
  });
  state.dirty = true;
  render();
}

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
  if (e.key === 'Escape') { textInput.hidden = true; }
});
textInput.addEventListener('blur', commitText);

/* ------------------------------------------------------------ tool switch */

function setTool(tool) {
  state.tool = tool;
  if (tool !== 'crop') { cropRect = null; cropStart = null; }
  document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  stage.style.cursor = tool === 'select' ? 'grab' : tool === 'text' ? 'text' : 'crosshair';
  render();
}

document.querySelectorAll('.tool[data-tool]').forEach((b) => {
  b.addEventListener('click', () => setTool(b.dataset.tool));
});

document.getElementById('size').addEventListener('input', (e) => { state.size = +e.target.value; });
document.getElementById('fontSize').addEventListener('input', (e) => { state.fontSize = +e.target.value; });
document.getElementById('color').addEventListener('input', (e) => {
  state.color = e.target.value;
  document.querySelectorAll('#swatches button').forEach((b) => b.classList.remove('on'));
});

document.getElementById('btnUndo').addEventListener('click', () => {
  state.shapes.pop();
  render();
});
document.getElementById('btnClear').addEventListener('click', () => {
  state.shapes = [];
  render();
});

document.getElementById('zoomIn').addEventListener('click', () => { state.zoom = Math.min(4, state.zoom * 1.25); layout(); });
document.getElementById('zoomOut').addEventListener('click', () => { state.zoom = Math.max(0.05, state.zoom / 1.25); layout(); });
document.getElementById('zoomFit').addEventListener('click', fitIfLarge);

window.addEventListener('resize', () => { /* keep zoom */ });

/* ------------------------------------------------------------- exporting */

function composite({ whiteBg = false } = {}) {
  const c = document.createElement('canvas');
  c.width = state.base.width;
  c.height = state.base.height;
  const cc = c.getContext('2d');
  if (whiteBg) {
    cc.fillStyle = '#fff';
    cc.fillRect(0, 0, c.width, c.height);
  }
  cc.drawImage(state.base, 0, 0);
  for (const sh of state.shapes) drawShape(cc, sh);
  return c;
}

function download(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

document.getElementById('btnPng').addEventListener('click', () => {
  download(composite().toDataURL('image/png'), `snapcompass-${stamp()}.png`);
});

document.getElementById('btnJpg').addEventListener('click', () => {
  download(composite({ whiteBg: true }).toDataURL('image/jpeg', 0.92), `snapcompass-${stamp()}.jpg`);
});

document.getElementById('btnPdf').addEventListener('click', () => {
  const canvas = composite({ whiteBg: true });
  const { jsPDF } = window.jspdf;
  const landscape = canvas.width > canvas.height;
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const ratio = Math.min((pw - margin * 2) / canvas.width, (ph - margin * 2) / canvas.height);
  const w = canvas.width * ratio;
  const h = canvas.height * ratio;
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', (pw - w) / 2, margin, w, h);
  pdf.save(`snapcompass-${stamp()}.pdf`);
});

document.getElementById('btnCopy').addEventListener('click', async () => {
  try {
    const blob = await new Promise((r) => composite().toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    const btn = document.getElementById('btnCopy');
    const old = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = old; }, 1400);
  } catch (e) {
    alert('Clipboard copy failed: ' + e.message);
  }
});

/* -------------------------------------------------------------- shortcuts */

window.addEventListener('keydown', (e) => {
  if (e.target === textInput) return;
  const map = { v: 'select', p: 'pen', l: 'line', a: 'arrow', r: 'rect', e: 'ellipse', t: 'text', m: 'mosaic', c: 'crop' };
  if (!e.ctrlKey && !e.metaKey && map[e.key.toLowerCase()]) { setTool(map[e.key.toLowerCase()]); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    state.shapes.pop();
    render();
  }
});

/* ------------------------------------------------------ paste / drag drop */

async function useImageBlob(blob) {
  const url = URL.createObjectURL(blob);
  const img = await loadImage(url);
  state.baseDpr = 1;
  state.base = makeBaseFromImage(img, null);
  state.shapes = [];
  emptyState.hidden = true;
  fitIfLarge();
  URL.revokeObjectURL(url);
}

window.addEventListener('paste', async (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  useImageBlob(item.getAsFile());
});

wrap.addEventListener('dragover', (e) => e.preventDefault());
wrap.addEventListener('drop', (e) => {
  const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
  if (!file) return;
  e.preventDefault();
  useImageBlob(file);
});

init().catch((e) => {
  console.error(e);
  alert('Editor failed to load: ' + e.message);
});
