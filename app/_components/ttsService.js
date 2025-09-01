// app/ttsService.js
import * as Speech from 'expo-speech';
import { EventEmitter } from 'events';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const normalizeOpts = (opts) => {
  const o = { ...opts };
  // 속도 빨라지는 이슈 방지: 항상 안전 범위로 강제
  o.rate  = clamp(typeof o.rate  === 'number' ? o.rate  : 1.0, 0.8, 1.05);
  o.pitch = clamp(typeof o.pitch === 'number' ? o.pitch : 1.0, 0.9, 1.1);
  return o;
};

class TTSService {
  queue = [];
  isSpeaking = false;
  emitter = new EventEmitter();
  lastSaid = new Map();
  defaultOpts = {
    language: 'ko-KR',
    rate: 1.0,
    pitch: 1.0,
    voice: undefined, // 필요시 identifier 지정
  };

  setDefaults({ language, rate, pitch, voice } = {}) {
    this.defaultOpts = normalizeOpts({
      ...this.defaultOpts,
      ...(language && { language }),
      ...(rate && { rate }),
      ...(pitch && { pitch }),
      ...(voice && { voice }),
    });
  }

  stop() {
    try { Speech.stop(); } catch {}
    this.isSpeaking = false;
  }

  speak(text, { priority = 0, type = 'generic', dedupeMs = 1500, voice, rate, pitch } = {}) {
    if (!text) return;
    // 간단 디듀프: 같은 type+text가 너무 자주 나오면 무시
    const key = `${type}:${text}`;
    const now = Date.now();
    if (now - (this.lastSaid.get(key) || 0) < dedupeMs) return;
    this.lastSaid.set(key, now);

    const opts = normalizeOpts({ ...this.defaultOpts, voice, rate, pitch });
    this.queue.push({ text, priority, opts });
    // 높은 priority 먼저
    this.queue.sort((a, b) => b.priority - a.priority);
    this._drain();
  }

  flushSpeak(text, { priority = 100, type = 'urgent', voice, rate, pitch } = {}) {
    // 긴급 발화: 기존 발화/큐 정리 후 즉시
    this.stop();
    this.queue = [];
    this.speak(text, { priority, type, voice, rate, pitch, dedupeMs: 500 });
  }

  async _drain() {
    if (this.isSpeaking || this.queue.length === 0) return;
    const item = this.queue.shift();
    this.isSpeaking = true;

    return new Promise((resolve) => {
      Speech.speak(item.text, {
        ...item.opts,
        onDone:   () => { this.isSpeaking = false; this._drain(); resolve(); },
        onStopped:() => { this.isSpeaking = false; this._drain(); resolve(); },
        onError:  () => { this.isSpeaking = false; this._drain(); resolve(); },
      });
    });
  }
}

const tts = new TTSService();
export default tts;
