import { PianoDetector } from './pitch-detector.js';

window.__moduleLoaded = true;
console.log('[init] game.js module loaded');
// 隐藏可能已经触发的「模块加载超时」红框
const _errBox = document.getElementById('errorBox');
if (_errBox && _errBox.style.display === 'block') _errBox.style.display = 'none';

const startBtn = document.getElementById('startBtn');
const statusEl = document.getElementById('status');
const bigNote = document.getElementById('bigNote');
const bigVel = document.getElementById('bigVelocity');

const dbg = {
  state: document.getElementById('dbg-state'),
  deviceLabel: document.getElementById('dbg-device'),
  sampleRate: document.getElementById('dbg-samplerate'),
  audioProc: document.getElementById('dbg-audioproc'),
  statTrig: document.getElementById('dbg-stat-trig'),
  statNoSpike: document.getElementById('dbg-stat-nospike'),
  statClarity: document.getElementById('dbg-stat-clarity'),
  statOct: document.getElementById('dbg-stat-oct'),
  statDebounce: document.getElementById('dbg-stat-debounce'),
  freq: document.getElementById('dbg-freq'),
  note: document.getElementById('dbg-note'),
  clarity: document.getElementById('dbg-clarity'),
  rms: document.getElementById('dbg-rms'),
  rmsDelta: document.getElementById('dbg-rms-delta'),
  ambient: document.getElementById('dbg-ambient'),
  threshold: document.getElementById('dbg-threshold'),
  last: document.getElementById('dbg-last'),
};

let audioContext;
let detector;
let running = false;

// 测试日志
const triggerLog = [];
let markCount = 0;
let noteCount = 0;
const logList = document.getElementById('logList');
const cntNote = document.getElementById('cntNote');
const cntMark = document.getElementById('cntMark');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function formatClock(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function appendLog(entry) {
  triggerLog.push(entry);
  const row = document.createElement('div');
  row.className = 'log-row ' + entry.type;
  if (entry.type === 'note') {
    row.innerHTML =
      `<span class="t">${formatClock(new Date(entry.wallTime))}</span>` +
      `<span class="n">${entry.note}</span>` +
      `<span class="v">v=${entry.velocity.toFixed(2)} · ${entry.freq.toFixed(0)}Hz · c=${entry.clarity.toFixed(2)}</span>`;
    noteCount++;
    cntNote.textContent = noteCount;
  } else if (entry.type === 'mark') {
    row.textContent = `━━━ ${entry.label} ━━━`;
    cntMark.textContent = markCount;
  }
  logList.insertBefore(row, logList.firstChild);
  while (logList.children.length > 400) logList.removeChild(logList.lastChild);
}

document.getElementById('markBtn').addEventListener('click', () => {
  if (!running) return;
  markCount++;
  // 把上一段的 stats 快照写入日志，然后清零
  const statsSnapshot = detector ? { ...detector.stats } : null;
  appendLog({
    type: 'mark',
    label: `标记 ${markCount}`,
    timestamp: performance.now(),
    wallTime: new Date().toISOString(),
    statsBeforeReset: statsSnapshot,
  });
  if (detector) {
    Object.keys(detector.stats).forEach(k => detector.stats[k] = 0);
  }
});

function buildPayload() {
  return {
    exportedAt: new Date().toISOString(),
    config: detector ? detector.config : null,
    ambientRms: detector ? detector.ambientRms : null,
    maxObservedRms: detector ? detector.maxObservedRms : null,
    finalStats: detector ? { ...detector.stats } : null,
    sampleRate: audioContext ? audioContext.sampleRate : null,
    userAgent: navigator.userAgent,
    entries: triggerLog,
  };
}

document.getElementById('downloadBtn').addEventListener('click', () => {
  const text = JSON.stringify(buildPayload(), null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = `midi-survivor-log-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

document.getElementById('copyBtn').addEventListener('click', async () => {
  const text = JSON.stringify(buildPayload(), null, 2);
  // 优先 Clipboard API
  try {
    await navigator.clipboard.writeText(text);
    alert(`✓ 已复制 ${triggerLog.length} 条记录到剪贴板。\n粘贴到聊天发回即可。`);
    return;
  } catch (e) {
    console.warn('clipboard API failed:', e);
  }
  // 兜底：弹出全屏 textarea 让用户手动选中复制
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:1000;' +
    'display:flex;flex-direction:column;padding:20px;gap:10px;';
  overlay.innerHTML =
    '<div style="color:#fff;font-size:14px;">长按下方文本框 → 全选 → 拷贝 → 粘贴到聊天发回</div>' +
    '<button id="closeOverlay" style="padding:10px;background:#3b82f6;color:#fff;border:none;border-radius:6px;font-size:16px;">关闭</button>';
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText =
    'flex:1;width:100%;font:11px monospace;background:#111;color:#0f0;' +
    'border:1px solid #444;padding:8px;border-radius:4px;';
  ta.readOnly = true;
  overlay.appendChild(ta);
  document.body.appendChild(overlay);
  overlay.querySelector('#closeOverlay').onclick = () => overlay.remove();
  ta.focus();
  ta.select();
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (!confirm('清空所有日志？')) return;
  triggerLog.length = 0;
  noteCount = 0;
  markCount = 0;
  cntNote.textContent = '0';
  cntMark.textContent = '0';
  logList.innerHTML = '';
});

async function start() {
  console.log('[click] start button pressed');
  startBtn.disabled = true;
  statusEl.textContent = '请求麦克风权限...';
  dbg.state.textContent = '请求权限';

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = '此环境不支持 getUserMedia（需要 https:// 或 http://localhost）';
    dbg.state.textContent = 'API 不可用';
    startBtn.disabled = false;
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
        channelCount: 1,
        // 不强制 sampleRate — iOS Safari 会忽略且可能报错，让它自己选
      },
    });
  } catch (err) {
    statusEl.textContent = '麦克风权限被拒绝：' + err.message;
    dbg.state.textContent = '权限失败';
    startBtn.disabled = false;
    return;
  }

  // iOS 必须 resume，不然 context 是 suspended 状态
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  try { await audioContext.resume(); } catch (e) { console.warn('resume failed', e); }

  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);

  // 检查 iOS 是否真的按我们要求关掉音频处理
  const track = stream.getAudioTracks()[0];
  const trackSettings = track.getSettings ? track.getSettings() : {};
  console.log('[init] audioContext.sampleRate =', audioContext.sampleRate);
  console.log('[init] track settings =', JSON.stringify(trackSettings));
  console.log('[init] track label =', track.label);

  const procFlags = [];
  if (trackSettings.echoCancellation === true) procFlags.push('EC');
  if (trackSettings.autoGainControl === true) procFlags.push('AGC');
  if (trackSettings.noiseSuppression === true) procFlags.push('NS');
  const audioProcText = procFlags.length === 0
    ? '✓ 已关闭'
    : `⚠ ${procFlags.join('+')} 强制开着`;
  if (dbg.audioProc) dbg.audioProc.textContent = audioProcText;
  if (dbg.sampleRate) dbg.sampleRate.textContent = audioContext.sampleRate + ' Hz';
  if (dbg.deviceLabel) dbg.deviceLabel.textContent = (track.label || '未知设备').slice(0, 24);

  detector = new PianoDetector(audioContext, analyser);
  detector.onTrigger((evt) => {
    bigNote.textContent = evt.note;
    bigNote.style.color = '#4ade80';
    bigVel.textContent = `velocity ${evt.velocity.toFixed(3)} · clarity ${evt.clarity.toFixed(3)} · ${evt.freq.toFixed(1)}Hz`;
    setTimeout(() => { bigNote.style.color = '#4ade80aa'; }, 120);
    console.log(`[note] ${evt.note} v=${evt.velocity.toFixed(3)} f=${evt.freq.toFixed(1)}Hz clarity=${evt.clarity.toFixed(3)}`);
    appendLog({
      type: 'note',
      note: evt.note,
      midi: evt.midi,
      freq: evt.freq,
      velocity: evt.velocity,
      clarity: evt.clarity,
      timestamp: evt.timestamp,
      wallTime: new Date().toISOString(),
    });
  });

  statusEl.textContent = '校准中... 请保持安静 2 秒';
  dbg.state.textContent = '校准中';
  await detector.calibrate(2000, (p) => {
    statusEl.textContent = `校准中... ${Math.round(p * 100)}%（请保持安静）`;
  });

  statusEl.textContent = '校准完成。开始弹琴吧。';
  dbg.state.textContent = '运行中';
  console.log(`[calibration] ambient rms = ${detector.ambientRms.toFixed(6)}`);

  running = true;
  loop();
}

function loop() {
  if (!running) return;
  const t = performance.now();
  detector.process(t);
  updateDebug();
  requestAnimationFrame(loop);
}

function updateDebug() {
  const r = detector.lastResult;
  dbg.freq.textContent = r.freq ? r.freq.toFixed(1) : '-';
  dbg.note.textContent = r.note;
  dbg.clarity.textContent = r.clarity.toFixed(3);
  dbg.rms.textContent = r.rms.toFixed(5);
  const deltaStr = r.rmsDelta.toFixed(5);
  dbg.rmsDelta.textContent = (r.rmsDelta > 0 ? '+' : '') + deltaStr;
  dbg.rmsDelta.className = r.rmsDelta > detector.config.energyDerivativeThreshold ? 'value trigger' : 'value';
  dbg.ambient.textContent = r.ambientRms.toFixed(6);
  dbg.threshold.textContent = r.triggerThreshold.toFixed(5);
  if (r.lastTriggered) {
    const lt = r.lastTriggered;
    const age = ((performance.now() - lt.timestamp) / 1000).toFixed(1);
    dbg.last.textContent = `${lt.note} v=${lt.velocity.toFixed(2)} (${age}s 前)`;
  }
  const s = detector.stats;
  if (s) {
    dbg.statTrig.textContent = s.triggered;
    dbg.statNoSpike.textContent = s.rejectedNoSpike;
    dbg.statClarity.textContent = s.rejectedClarity;
    dbg.statOct.textContent = s.rejectedOctave;
    dbg.statDebounce.textContent = s.rejectedDebounce;
  }
}

startBtn.addEventListener('click', start);
