import { PitchDetector } from 'https://esm.sh/pitchy@4';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function freqToNote(freq) {
  const noteNum = 12 * Math.log2(freq / 440) + 69;
  const rounded = Math.round(noteNum);
  const octave = Math.floor(rounded / 12) - 1;
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  return { name: `${name}${octave}`, midi: rounded, cents: (noteNum - rounded) * 100 };
}

export class PianoDetector {
  constructor(audioContext, analyserNode) {
    this.audioContext = audioContext;
    this.analyser = analyserNode;

    this.config = {
      bufferSize: 2048,
      clarityThreshold: 0.85,        // v2: 0.9 → 0.85（iPad 漏音太多）
      ambientMultiplier: 4,
      octaveWindowMs: 200,
      octaveClarityDelta: 0.05,
      debounceMs: 150,
      energyDerivativeThreshold: 0.002,  // v2: 0.005 → 0.002（流畅弹奏 attack 较柔）
      minFreq: 27.5,
      maxFreq: 4186,
    };

    // 拒绝原因统计（诊断用）
    this.stats = {
      framesAboveAmbient: 0,
      framesValidPitch: 0,
      framesEnergySpike: 0,
      framesAllConditions: 0,
      triggered: 0,
      rejectedClarity: 0,    // above ambient + energy spike, 但 clarity 不够
      rejectedRange: 0,      // above ambient + energy spike + 高 clarity, 但频率超钢琴范围
      rejectedNoSpike: 0,    // above ambient + valid pitch, 但能量没上扬（attack 漏检）
      rejectedOctave: 0,     // 全条件满足但被八度过滤
      rejectedDebounce: 0,   // 全条件满足但 150ms 防抖
    };

    this.pitchy = PitchDetector.forFloat32Array(this.config.bufferSize);
    this.buffer = new Float32Array(this.config.bufferSize);

    this.ambientRms = 0;
    this.maxObservedRms = 0.05;
    this.previousRms = 0;
    this.pitchHistory = [];
    this.lastTriggerByNote = {};

    this.lastResult = {
      freq: 0, note: '-', clarity: 0, rms: 0, rmsDelta: 0,
      ambientRms: 0, triggered: null, lastTriggered: null,
    };

    this._fpsCount = 0;
    this._fpsLastLog = performance.now();
    this._procTimes = [];
    this._onTriggerCb = null;
  }

  onTrigger(cb) { this._onTriggerCb = cb; }

  _calcRms(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    return Math.sqrt(sum / buffer.length);
  }

  async calibrate(durationMs = 2000, onProgress) {
    const samples = [];
    const start = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        const elapsed = performance.now() - start;
        this.analyser.getFloatTimeDomainData(this.buffer);
        samples.push(this._calcRms(this.buffer));
        if (onProgress) onProgress(Math.min(1, elapsed / durationMs));
        if (elapsed < durationMs) {
          requestAnimationFrame(tick);
        } else {
          const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
          this.ambientRms = avg;
          // v2: 下限 0.05 → 0.005，适配 iPad 这种超灵敏 mic
          // （iPad ambient ~0.0002, Mac ambient ~0.005, 旧下限让 iPad velocity 永远 <0.7）
          this.maxObservedRms = Math.max(0.005, avg * 8);
          resolve(avg);
        }
      };
      tick();
    });
  }

  _isOctaveError(pitch, clarity, timestamp) {
    const window = this.config.octaveWindowMs;
    for (const h of this.pitchHistory) {
      if (timestamp - h.time > window) continue;
      const ratio = pitch / h.freq;
      if (Math.abs(ratio - 2) < 0.05) {
        if (clarity - h.clarity < this.config.octaveClarityDelta) return true;
      }
    }
    return false;
  }

  process(timestamp) {
    const t0 = performance.now();
    this.analyser.getFloatTimeDomainData(this.buffer);

    const rms = this._calcRms(this.buffer);
    const rmsDelta = rms - this.previousRms;
    this.previousRms = rms;

    if (rms > this.maxObservedRms) this.maxObservedRms = rms;

    const [pitch, clarity] = this.pitchy.findPitch(this.buffer, this.audioContext.sampleRate);

    const aboveAmbient = rms > this.ambientRms * this.config.ambientMultiplier;
    const energySpike = rmsDelta > this.config.energyDerivativeThreshold;
    const clarityOk = clarity > this.config.clarityThreshold;
    const rangeOk = pitch >= this.config.minFreq && pitch <= this.config.maxFreq && isFinite(pitch);
    const validPitch = clarityOk && rangeOk;

    if (aboveAmbient) this.stats.framesAboveAmbient++;
    if (aboveAmbient && validPitch) this.stats.framesValidPitch++;
    if (aboveAmbient && energySpike) this.stats.framesEnergySpike++;

    let triggered = null;

    if (aboveAmbient && validPitch) {
      this.pitchHistory.push({ time: timestamp, freq: pitch, clarity });
      this.pitchHistory = this.pitchHistory.filter(h => timestamp - h.time < 500);
    }

    // 诊断：above ambient + valid pitch + 没 energy spike → 漏检 attack
    if (aboveAmbient && validPitch && !energySpike) {
      this.stats.rejectedNoSpike++;
    }
    // 诊断：above ambient + energy spike + invalid pitch
    if (aboveAmbient && energySpike && !validPitch) {
      if (!clarityOk) this.stats.rejectedClarity++;
      else if (!rangeOk) this.stats.rejectedRange++;
    }

    if (aboveAmbient && energySpike && validPitch) {
      this.stats.framesAllConditions++;
      if (this._isOctaveError(pitch, clarity, timestamp)) {
        this.stats.rejectedOctave++;
      } else {
        const note = freqToNote(pitch);
        const lastT = this.lastTriggerByNote[note.name] || 0;
        if (timestamp - lastT > this.config.debounceMs) {
          const velocity = Math.min(1, Math.max(0, rms / this.maxObservedRms));
          triggered = {
            note: note.name, midi: note.midi, freq: pitch,
            velocity, clarity, timestamp,
          };
          this.lastTriggerByNote[note.name] = timestamp;
          this.stats.triggered++;
          if (this._onTriggerCb) this._onTriggerCb(triggered);
        } else {
          this.stats.rejectedDebounce++;
        }
      }
    }

    this.lastResult = {
      freq: validPitch ? pitch : 0,
      note: validPitch ? freqToNote(pitch).name : '-',
      clarity,
      rms,
      rmsDelta,
      ambientRms: this.ambientRms,
      triggerThreshold: this.ambientRms * this.config.ambientMultiplier,
      triggered,
      lastTriggered: triggered || this.lastResult.lastTriggered,
    };

    const t1 = performance.now();
    this._procTimes.push(t1 - t0);
    this._fpsCount++;
    const now = performance.now();
    if (now - this._fpsLastLog > 1000) {
      const avg = this._procTimes.reduce((a, b) => a + b, 0) / this._procTimes.length;
      console.log(
        `[perf] FPS=${this._fpsCount}, avg process=${avg.toFixed(2)}ms, ` +
        `ambient=${this.ambientRms.toFixed(5)}, maxRms=${this.maxObservedRms.toFixed(4)}`
      );
      this._fpsCount = 0;
      this._procTimes = [];
      this._fpsLastLog = now;
    }

    return triggered;
  }
}
