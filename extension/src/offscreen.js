/* SnapCompass offscreen recorder: holds getUserMedia stream + MediaRecorder,
 * encodes results to MP4/WebM or GIF (via gif.js), then asks the background
 * worker to save the file with chrome.downloads.
 */

let stream = null;
let recorder = null;
let chunks = [];
let config = null;

const MP4_CANDIDATES = [
  'video/mp4;codecs=avc1.64001f,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=h264,opus',
  'video/webm'
];

const WEBM_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
];

function pickMime(candidates) {
  return candidates.find((m) => {
    try { return MediaRecorder.isTypeSupported(m); } catch { return false; }
  }) || '';
}

async function getStream({ streamId, source, audio }) {
  if (source === 'tab') {
    return navigator.mediaDevices.getUserMedia({
      audio: audio
        ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
        : false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
          maxWidth: 3840,
          maxHeight: 2160,
          maxFrameRate: 30
        }
      }
    });
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: streamId,
        maxWidth: 3840,
        maxHeight: 2160,
        maxFrameRate: 30
      }
    }
  });
}

async function start(msg) {
  if (recorder) throw new Error('Already recording');
  config = msg;
  stream = await getStream(msg);
  stream.getVideoTracks()[0].addEventListener('ended', () => {
    if (recorder && recorder.state !== 'inactive') stop().catch(console.error);
  });
  const mime = pickMime(msg.format === 'gif' ? WEBM_CANDIDATES : MP4_CANDIDATES);
  chunks = [];
  recorder = new MediaRecorder(stream, {
    mimeType: mime || undefined,
    videoBitsPerSecond: 6_000_000
  });
  recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  recorder.start(500);
  return { mime: recorder.mimeType };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function loadVideo(blob) {
  return new Promise((resolve, reject) => {
    const v = document.getElementById('v');
    const url = URL.createObjectURL(blob);
    v.src = url;
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => reject(new Error('Could not decode recording'));
  });
}

async function encodeGif(blob) {
  const video = await loadVideo(blob);
  const maxW = 640;
  const scale = Math.min(1, maxW / video.videoWidth);
  const w = Math.max(2, Math.round(video.videoWidth * scale));
  const h = Math.max(2, Math.round(video.videoHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const fps = 10;
  const duration = Math.min(video.duration || 0, 60); // cap at 60s for GIF sanity
  const frames = Math.max(1, Math.floor(duration * fps));

  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: w,
    height: h,
    workerScript: chrome.runtime.getURL('vendor/gif.worker.js')
  });

  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    await new Promise((resolve) => {
      video.onseeked = resolve;
      video.currentTime = t;
    });
    ctx.drawImage(video, 0, 0, w, h);
    gif.addFrame(ctx, { copy: true, delay: 1000 / fps });
  }

  return new Promise((resolve, reject) => {
    gif.on('finished', resolve);
    gif.on('abort', () => reject(new Error('GIF encoding aborted')));
    gif.render();
  });
}

async function stop() {
  if (!recorder) throw new Error('Not recording');
  const rec = recorder;
  recorder = null;
  await new Promise((resolve) => {
    rec.onstop = resolve;
    rec.stop();
  });
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;

  const mime = rec.mimeType || 'video/webm';
  const blob = new Blob(chunks, { type: mime });
  chunks = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  let outBlob = blob;
  let filename;
  if (config?.format === 'gif') {
    outBlob = await encodeGif(blob);
    filename = `snapcompass-${stamp}.gif`;
  } else {
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    filename = `snapcompass-${stamp}.${ext}`;
  }

  const dataUrl = await blobToDataUrl(outBlob);
  await chrome.runtime.sendMessage({ type: 'save-file', dataUrl, filename, saveAs: true });
  await chrome.runtime.sendMessage({ type: 'recording-finished' }).catch(() => {});
  return { filename };
}

function cancel() {
  try { recorder?.stop(); } catch {}
  recorder = null;
  chunks = [];
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  (async () => {
    try {
      if (msg.type === 'rec-start') sendResponse({ ok: true, ...(await start(msg)) });
      else if (msg.type === 'rec-stop') sendResponse({ ok: true, ...(await stop()) });
      else if (msg.type === 'rec-cancel') { cancel(); sendResponse({ ok: true }); }
      else sendResponse({ ok: false, error: 'unknown offscreen message' });
    } catch (e) {
      cancel();
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true;
});
