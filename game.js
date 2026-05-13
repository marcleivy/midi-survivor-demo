import { PianoDetector } from './pitch-detector.js';

const startBtn = document.getElementById('startBtn');
const statusEl = document.getElementById('status');
const bigNote = document.getElementById('bigNote');
const bigVel = document.getElementById('bigVelocity');

const dbg = {
  state: document.getElementById('dbg-state'),
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

async function start() {
  startBtn.disabled = true;
  statusEl.textContent = '请求麦克风权限...';
  dbg.state.textContent = '请求权限';

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
        channelCount: 1,
        sampleRate: 44100,
      },
    });
  } catch (err) {
    statusEl.textContent = '麦克风权限被拒绝：' + err.message;
    dbg.state.textContent = '权限失败';
    startBtn.disabled = false;
    return;
  }

  audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);

  console.log(`[init] audioContext.sampleRate = ${audioContext.sampleRate}`);

  detector = new PianoDetector(audioContext, analyser);
  detector.onTrigger((evt) => {
    bigNote.textContent = evt.note;
    bigNote.style.color = '#4ade80';
    bigVel.textContent = `velocity ${evt.velocity.toFixed(3)} · clarity ${evt.clarity.toFixed(3)} · ${evt.freq.toFixed(1)}Hz`;
    setTimeout(() => { bigNote.style.color = '#4ade80aa'; }, 120);
    console.log(`[note] ${evt.note} v=${evt.velocity.toFixed(3)} f=${evt.freq.toFixed(1)}Hz clarity=${evt.clarity.toFixed(3)}`);
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
}

startBtn.addEventListener('click', start);
