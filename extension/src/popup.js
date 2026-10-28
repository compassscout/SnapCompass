/* SnapCompass popup */
const $ = (s) => document.querySelector(s);
const errBox = $('#err');
const recBtn = $('#recBtn');
const recStatus = $('#recStatus');
let timer = null;

function showErr(msg) {
  errBox.hidden = false;
  errBox.textContent = msg;
  clearTimeout(showErr._t);
  showErr._t = setTimeout(() => { errBox.hidden = true; }, 5000);
}

async function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

document.querySelectorAll('.cap').forEach((btn) => {
  btn.addEventListener('click', async () => {
    try {
      const res = await send({ type: btn.dataset.action === 'capture-region' ? 'start-region' : btn.dataset.action });
      if (!res?.ok) throw new Error(res?.error || 'Capture failed');
      window.close();
    } catch (e) {
      showErr(e.message);
    }
  });
});

$('#openEditor').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/editor.html') });
  window.close();
});

let source = 'tab';
$('#sourceSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-source]');
  if (!b) return;
  source = b.dataset.source;
  document.querySelectorAll('#sourceSeg button').forEach((x) => x.classList.toggle('on', x === b));
});

function setRecUI(recording) {
  const btn = recBtn;
  if (recording) {
    btn.classList.add('stop');
    btn.innerHTML = '<span class="dot"></span> Stop recording';
    recStatus.hidden = false;
    const tick = () => {
      const s = Math.floor((Date.now() - recording.startedAt) / 1000);
      recStatus.textContent = `Recording ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} · ${recording.format.toUpperCase()} · ${recording.source}`;
    };
    tick();
    clearInterval(timer);
    timer = setInterval(tick, 1000);
  } else {
    btn.classList.remove('stop', 'stopping');
    btn.innerHTML = '<span class="dot"></span> Start recording';
    recStatus.hidden = true;
    clearInterval(timer);
  }
}

recBtn.addEventListener('click', async () => {
  const { recording } = await chrome.storage.local.get('recording');
  if (recording?.active) {
    recBtn.classList.add('stopping');
    recBtn.textContent = 'Processing…';
    recStatus.hidden = false;
    recStatus.textContent = 'Encoding video, please wait…';
    const res = await send({ type: 'record-stop' });
    if (!res?.ok) showErr(res?.error || 'Failed to stop recording');
    setRecUI(null);
  } else {
    try {
      const res = await send({
        type: 'record-start',
        source,
        format: $('#format').value,
        audio: $('#audio').checked
      });
      if (!res?.ok) throw new Error(res?.error || 'Failed to start recording');
      setRecUI({ active: true, startedAt: Date.now(), source, format: $('#format').value });
    } catch (e) {
      showErr(e.message);
    }
  }
});

(async () => {
  const res = await send({ type: 'recording-state' });
  if (res?.recording) setRecUI(res.recording);
})();
