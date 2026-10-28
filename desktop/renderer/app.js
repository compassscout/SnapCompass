/* SnapCompass Desktop — renderer logic (toolbar, capture, recording) */

const frame = document.getElementById('editorFrame');
const btnFull = document.getElementById('btnFull');
const btnRegion = document.getElementById('btnRegion');
const btnRec = document.getElementById('btnRec');
const btnOpen = document.getElementById('btnOpen');
const fileInput = document.getElementById('fileInput');
const recTimer = document.getElementById('recTimer');
const recTime = document.getElementById('recTime');
const recFmt = document.getElementById('recFmt');
const srcModal = document.getElementById('srcModal');
const srcGrid = document.getElementById('srcGrid');
const srcCancel = document.getElementById('srcCancel');

let frameReady = false;
let pendingShot = null;

frame.addEventListener('load', () => {
  frameReady = true;
  if (pendingShot) {
    const { dataUrl, dpr } = pendingShot;
    pendingShot = null;
    sendToEditor(dataUrl, dpr);
  }
});

function sendToEditor(dataUrl, dpr) {
  if (!frameReady || !frame.contentWindow || typeof frame.contentWindow.loadScreenshot !== 'function') {
    pendingShot = { dataUrl, dpr };
    return;
  }
  frame.contentWindow.loadScreenshot(dataUrl, dpr);
}

/* ---------------------------------------------------------- screenshots */

btnFull.addEventListener('click', async () => {
  btnFull.disabled = true;
  try {
    const shot = await window.snapApi.captureScreen();
    sendToEditor(shot.dataUrl, shot.dpr);
  } catch (e) {
    alert('截取全屏失败: ' + e.message);
  } finally {
    btnFull.disabled = false;
  }
});

btnRegion.addEventListener('click', () => window.snapApi.captureRegionStart());

window.snapApi.onScreenshot(({ dataUrl, dpr }) => sendToEditor(dataUrl, dpr));

btnOpen.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => sendToEditor(reader.result, 1);
  reader.readAsDataURL(file);
});

/* ----------------------------------------------------------- recording */

let recorder = null;
let recStream = null;
let recChunks = [];
let recStartedAt = 0;
let recTicker = null;

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function setRecUi(on) {
  recTimer.classList.toggle('on', on);
  btnRec.classList.toggle('rec', on);
  btnRec.textContent = on ? '⏹ 停止录屏' : '⏺ 开始录屏';
  recFmt.disabled = on;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}

async function pickSource() {
  const sources = await window.snapApi.getDesktopSources();
  return new Promise((resolve) => {
    srcGrid.innerHTML = '';
    if (!sources.length) { resolve(null); return; }
    sources.forEach((s) => {
      const b = document.createElement('button');
      b.className = 'src-item';
      const img = document.createElement('img');
      img.src = s.thumbnail || '';
      img.alt = '';
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = s.name;
      b.appendChild(img);
      b.appendChild(nm);
      b.addEventListener('click', () => { srcModal.classList.remove('on'); resolve(s.id); });
      srcGrid.appendChild(b);
    });
    srcCancel.onclick = () => { srcModal.classList.remove('on'); resolve(null); };
    srcModal.classList.add('on');
  });
}

async function startRecording() {
  const sourceId = await pickSource();
  if (!sourceId) return;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: 1920,
          maxHeight: 1080,
          maxFrameRate: 30
        }
      }
    });
  } catch (e) {
    alert('无法开始录制: ' + e.message);
    return;
  }

  recStream = stream;
  recChunks = [];
  const wantGif = recFmt.value === 'gif';
  const mime = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
  recorder = new MediaRecorder(stream, { mimeType: mime });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  recorder.onstop = async () => {
    const blob = new Blob(recChunks, { type: mime });
    recChunks = [];
    if (wantGif) {
      await saveGif(blob);
    } else {
      const ext = mime.includes('mp4') ? 'mp4' : 'webm';
      downloadBlob(blob, `snapcompass-${stamp()}.${ext}`);
    }
  };
  // stop via stream end (user closes source)
  stream.getVideoTracks()[0].addEventListener('ended', () => stopRecording());

  recorder.start(250);
  recStartedAt = Date.now();
  recTime.textContent = '00:00';
  recTicker = setInterval(() => { recTime.textContent = fmtTime(Date.now() - recStartedAt); }, 500);
  setRecUi(true);
}

function stopRecording() {
  if (recTicker) { clearInterval(recTicker); recTicker = null; }
  setRecUi(false);
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  recorder = null;
  if (recStream) {
    recStream.getTracks().forEach((t) => t.stop());
    recStream = null;
  }
}

btnRec.addEventListener('click', () => {
  if (recorder) stopRecording();
  else startRecording();
});

/* ------------------------------------------------- gif export pipeline */

async function saveGif(videoBlob) {
  const url = URL.createObjectURL(videoBlob);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => rej(new Error('视频解码失败'));
    });

    const duration = Math.min(video.duration || 0, 60); // 最长 60s
    if (!duration) throw new Error('视频时长为 0');

    const W = 640;
    const H = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * W));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext('2d');

    const gif = new GIF({
      workers: 2,
      quality: 12,
      width: W,
      height: H,
      workerScript: '../vendor/gif.worker.js'
    });

    const fps = 10;
    const frames = Math.max(1, Math.floor(duration * fps));
    for (let i = 0; i < frames; i++) {
      const t = i / fps;
      await new Promise((res) => {
        video.onseeked = res;
        video.currentTime = Math.min(t, duration - 0.05);
      });
      c.drawImage(video, 0, 0, W, H);
      gif.addFrame(canvas, { copy: true, delay: 1000 / fps });
    }

    const blob = await new Promise((res, rej) => {
      gif.on('finished', res);
      gif.on('abort', () => rej(new Error('GIF 编码中止')));
      gif.render();
    });
    downloadBlob(blob, `snapcompass-${stamp()}.gif`);
  } catch (e) {
    alert('GIF 导出失败，改为保存视频: ' + e.message);
    downloadBlob(videoBlob, `snapcompass-${stamp()}.webm`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
