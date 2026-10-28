/* SnapCompass — background service worker
 * Handles screenshot capture (visible / region / full page), recording orchestration
 * and hand-off to the annotation editor.
 */

const EDITOR_URL = chrome.runtime.getURL('src/editor.html');
const OFFSCREEN_URL = chrome.runtime.getURL('src/offscreen.html');

/* ------------------------------------------------------------------ helpers */

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function storeShot(shot) {
  const id = 'shot_' + Date.now() + '_' + Math.floor(Math.random() * 1e5);
  await chrome.storage.local.set({ [id]: shot });
  return id;
}

async function openEditor(shotId) {
  await chrome.tabs.create({ url: `${EDITOR_URL}?shot=${shotId}` });
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message
    });
  } catch (e) {
    console.warn('notification failed', e);
  }
}

/* ------------------------------------------------------- visible area shot */

async function captureVisible() {
  const tab = await getActiveTab();
  if (!tab) throw new Error('No active tab');
  if (/^(chrome|edge|about|chrome-extension|devtools):/i.test(tab.url || '')) {
    // Restricted pages cannot be captured, but captureVisibleTab still works on some of them.
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const id = await storeShot({
    kind: 'single',
    dataUrl,
    pageUrl: tab.url,
    pageTitle: tab.title,
    createdAt: Date.now()
  });
  await openEditor(id);
}

/* ---------------------------------------------------------- full page shot */

function pageHelperScroll(args) {
  const { y, hideFixed } = args;
  const dpr = window.devicePixelRatio || 1;
  if (hideFixed) {
    let style = document.getElementById('__snapcompass_fixed_hide__');
    if (!style) {
      style = document.createElement('style');
      style.id = '__snapcompass_fixed_hide__';
      style.textContent =
        '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }' +
        'body * { scroll-behavior: auto !important; }';
      document.documentElement.appendChild(style);
    }
    // Hide elements that stick to the viewport so they do not repeat in every tile.
    const fixed = document.querySelectorAll('body *');
    for (const el of fixed) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        el.dataset.__scPos = cs.position;
        el.style.setProperty('visibility', 'hidden', 'important');
      }
      if (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll|overlay)/.test(cs.overflowY) && el.clientHeight > window.innerHeight * 0.6) {
        el.dataset.__scOverflow = '1';
        el.style.setProperty('height', 'auto', 'important');
        el.style.setProperty('overflow', 'visible', 'important');
      }
    }
  }
  const maxScroll = Math.max(
    document.documentElement.scrollHeight,
    document.body ? document.body.scrollHeight : 0
  ) - window.innerHeight;
  const target = typeof y === 'number' ? Math.max(0, Math.min(y, maxScroll)) : window.scrollY;
  window.scrollTo(0, target);
  return {
    scrollY: window.scrollY,
    maxScroll,
    viewportH: window.innerHeight,
    viewportW: window.innerWidth,
    totalH: Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    ),
    dpr
  };
}

function pageHelperRestore() {
  const style = document.getElementById('__snapcompass_fixed_hide__');
  if (style) style.remove();
  document.querySelectorAll('[data-__sc-pos]').forEach((el) => {
    el.style.removeProperty('visibility');
    delete el.dataset.__scPos;
  });
  document.querySelectorAll('[data-__sc-overflow]').forEach((el) => {
    el.style.removeProperty('height');
    el.style.removeProperty('overflow');
    delete el.dataset.__scOverflow;
  });
  window.scrollTo(0, 0);
  return true;
}

async function captureFullPage() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) throw new Error('No active tab');

  const [{ result: metrics }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: pageHelperScroll,
    args: [{ y: 0, hideFixed: true }]
  });
  if (!metrics) throw new Error('Could not measure page');

  const { viewportH, viewportW, totalH, dpr } = metrics;
  const maxTiles = 30;
  const tiles = [];
  let y = 0;
  let guard = 0;

  try {
    while (y < totalH && guard < maxTiles) {
      const [{ result: pos }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: pageHelperScroll,
        args: [{ y, hideFixed: guard === 0 }]
      });
      await sleep(260);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      tiles.push({ dataUrl, scrollY: pos.scrollY });
      if (pos.scrollY >= pos.maxScroll - 1) break;
      const nextY = pos.scrollY + viewportH;
      if (nextY <= y) break;
      y = nextY;
      guard++;
      await sleep(320); // respect MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND
    }
  } finally {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageHelperRestore
    }).catch(() => {});
  }

  const id = await storeShot({
    kind: 'stitch',
    tiles,
    totalH,
    viewportH,
    viewportW,
    dpr,
    pageUrl: tab.url,
    pageTitle: tab.title,
    createdAt: Date.now()
  });
  await openEditor(id);
}

/* ------------------------------------------------------------ region shot */

function regionOverlayInit() {
  if (window.__snapcompassRegionActive) return;
  window.__snapcompassRegionActive = true;
  const dpr = window.devicePixelRatio || 1;

  const host = document.createElement('div');
  host.id = '__snapcompass_region_host__';
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(10,12,30,.35);';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .box { position: fixed; border: 2px solid #7c5cff; background: rgba(124,92,255,.12);
             box-shadow: 0 0 0 9999px rgba(10,12,30,.35); border-radius: 4px; }
      .hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
              background: #12142b; color: #e8e9ff; font: 500 13px/1.4 -apple-system,"Segoe UI",sans-serif;
              padding: 9px 16px; border-radius: 999px; border: 1px solid rgba(124,92,255,.5);
              box-shadow: 0 8px 28px rgba(0,0,0,.35); white-space: nowrap; }
      .size { position: fixed; background:#12142b; color:#e8e9ff; font: 500 12px/1 monospace;
              padding: 5px 8px; border-radius: 6px; border:1px solid rgba(124,92,255,.5); }
    </style>
    <div class="hint">Drag to select an area · Esc to cancel</div>
    <div class="box" hidden></div>
    <div class="size" hidden></div>
  `;
  const box = shadow.querySelector('.box');
  const size = shadow.querySelector('.size');
  const hint = shadow.querySelector('.hint');
  document.documentElement.appendChild(host);

  let sx = 0, sy = 0, drawing = false;

  const cleanup = () => {
    window.removeEventListener('keydown', onKey, true);
    host.remove();
    window.__snapcompassRegionActive = false;
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
  };

  const onDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    drawing = true;
    sx = e.clientX; sy = e.clientY;
    box.hidden = false; size.hidden = false; hint.hidden = true;
    draw(e.clientX, e.clientY);
  };

  const draw = (cx, cy) => {
    const x = Math.min(sx, cx), yy = Math.min(sy, cy);
    const w = Math.abs(cx - sx), h = Math.abs(cy - sy);
    box.style.left = x + 'px'; box.style.top = yy + 'px';
    box.style.width = w + 'px'; box.style.height = h + 'px';
    size.textContent = `${Math.round(w)} × ${Math.round(h)}`;
    const top = yy > 40 ? yy - 30 : yy + h + 8;
    size.style.left = Math.max(4, x) + 'px';
    size.style.top = top + 'px';
  };

  const onMove = (e) => {
    if (!drawing) return;
    e.preventDefault(); e.stopPropagation();
    draw(e.clientX, e.clientY);
  };

  const onUp = (e) => {
    if (!drawing) return;
    e.preventDefault(); e.stopPropagation();
    drawing = false;
    const x = Math.min(sx, e.clientX), yy = Math.min(sy, e.clientY);
    const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
    cleanup();
    if (w < 8 || h < 8) return;
    chrome.runtime.sendMessage({
      type: 'region-selected',
      rect: { x, y: yy, w, h, dpr }
    });
  };

  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('keydown', onKey, true);
}

async function startRegionCapture(senderTabId) {
  const tabId = senderTabId || (await getActiveTab())?.id;
  if (!tabId) throw new Error('No active tab');
  await chrome.scripting.executeScript({ target: { tabId }, func: regionOverlayInit });
}

async function onRegionSelected(rect, sender) {
  const tab = sender.tab || (await getActiveTab());
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const id = await storeShot({
    kind: 'single',
    dataUrl,
    crop: rect,
    pageUrl: tab.url,
    pageTitle: tab.title,
    createdAt: Date.now()
  });
  await openEditor(id);
}

/* --------------------------------------------------------------- recording */

let creatingOffscreen = null;

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA', 'BLOBS', 'DISPLAY_MEDIA'],
      justification: 'Record tab or desktop video and encode it to MP4/GIF.'
    })
    .catch((e) => {
      if (!String(e).includes('Only a single offscreen')) throw e;
    })
    .finally(() => { creatingOffscreen = null; });
  return creatingOffscreen;
}

async function startRecording({ source, format, audio }) {
  await ensureOffscreen();
  let streamId;
  if (source === 'tab') {
    const tab = await getActiveTab();
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  } else {
    streamId = await new Promise((resolve, reject) => {
      chrome.desktopCapture.chooseDesktopMedia(['screen', 'window'], (id) => {
        if (!id) reject(new Error('Screen selection cancelled'));
        else resolve(id);
      });
    });
  }
  await chrome.storage.local.set({ recording: { active: true, source, format, startedAt: Date.now() } });
  const res = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'rec-start',
    streamId,
    source,
    format,
    audio: !!audio
  });
  if (!res || !res.ok) {
    await chrome.storage.local.remove('recording');
    throw new Error(res?.error || 'Recorder failed to start');
  }
  return res;
}

async function stopRecording() {
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'rec-stop' }).catch((e) => ({ ok: false, error: String(e) }));
  await chrome.storage.local.remove('recording');
  return res;
}

/* -------------------------------------------------------------- messaging */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case 'capture-visible':
          await captureVisible();
          sendResponse({ ok: true });
          break;
        case 'capture-fullpage':
          await captureFullPage();
          sendResponse({ ok: true });
          break;
        case 'start-region':
          await startRegionCapture(msg.tabId);
          sendResponse({ ok: true });
          break;
        case 'region-selected':
          await onRegionSelected(msg.rect, sender);
          sendResponse({ ok: true });
          break;
        case 'record-start': {
          const r = await startRecording(msg);
          sendResponse({ ok: true, ...r });
          break;
        }
        case 'record-stop': {
          const r = await stopRecording();
          sendResponse({ ok: true, ...r });
          break;
        }
        case 'record-cancel':
          await chrome.runtime.sendMessage({ target: 'offscreen', type: 'rec-cancel' }).catch(() => {});
          await chrome.storage.local.remove('recording');
          sendResponse({ ok: true });
          break;
        case 'recording-state': {
          const { recording } = await chrome.storage.local.get('recording');
          sendResponse({ ok: true, recording: recording || null });
          break;
        }
        case 'save-file': {
          await chrome.downloads.download({ url: msg.dataUrl, filename: msg.filename, saveAs: !!msg.saveAs });
          sendResponse({ ok: true });
          break;
        }
        case 'recording-finished': {
          await chrome.storage.local.remove('recording');
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message: ' + msg?.type });
      }
    } catch (e) {
      console.error('[SnapCompass]', e);
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'sc-visible', title: 'SnapCompass: capture visible area', contexts: ['page', 'frame'] });
  chrome.contextMenus.create({ id: 'sc-full', title: 'SnapCompass: capture full page', contexts: ['page', 'frame'] });
  chrome.contextMenus.create({ id: 'sc-region', title: 'SnapCompass: capture region', contexts: ['page', 'frame'] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const map = { 'sc-visible': captureVisible, 'sc-full': captureFullPage, 'sc-region': () => startRegionCapture(tab?.id) };
  const fn = map[info.menuItemId];
  if (fn) fn().catch((e) => notify('SnapCompass', e.message));
});

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'capture-visible') captureVisible().catch((e) => notify('SnapCompass', e.message));
  if (cmd === 'capture-fullpage') captureFullPage().catch((e) => notify('SnapCompass', e.message));
  if (cmd === 'capture-region') startRegionCapture().catch((e) => notify('SnapCompass', e.message));
});
