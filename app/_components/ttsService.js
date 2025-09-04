import { AppState } from 'react-native'
import * as Speech from 'expo-speech'
import { Audio } from 'expo-av'

let DEFAULTS = {
  language: 'ko-KR',
  pitch: 1.0,
  rate: 1.0,         // 0.1 ~ 1.0 (expo-speech normalized)
  voice: undefined,  // leave undefined to let OS pick a high-quality voice
  category: 'playback',
  shouldDuckAndroid: false, // keep focus exclusively to avoid mixing (cuts)
  interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
  staysActiveInBackground: true,
}

let _initialized = false
let _enabled = true
let _queue = []
let _speaking = false
let _current = null
let _watchdog = null
let _retryCount = 0
let _lastKey = null
let _lastKeyAt = 0

function estimateDurationMs(text, rate=1.0) {
  // Rough estimate: 150 wpm baseline. Korean syllables -> approx 4.2 chars/word
  const chars = (text || '').length
  const words = Math.max(1, chars / 4.2)
  const minutes = words / 150
  const baseMs = minutes * 60 * 1000
  const adjusted = baseMs / Math.max(0.5, Math.min(rate, 2.0))
  // clamp 700ms ~ 30s
  return Math.min(Math.max(adjusted, 700), 30000)
}

async function initAudio() {
  if (_initialized) return
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: DEFAULTS.staysActiveInBackground,
      interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: DEFAULTS.shouldDuckAndroid === true ? true : false,
      interruptionModeAndroid: DEFAULTS.interruptionModeAndroid,
      playThroughEarpieceAndroid: false,
    })
    _initialized = true
  } catch (e) {
    // Ignore; we'll retry later
    console.warn('[tts] Audio.setAudioModeAsync failed:', e?.message || e)
  }
}

function _clearWatchdog() {
  if (_watchdog) {
    clearTimeout(_watchdog)
    _watchdog = null
  }
}

function _stopOS() {
  try {
    Speech.stop()
  } catch {}
}

function _resetState() {
  _clearWatchdog()
  _speaking = false
  _current = null
  _retryCount = 0
}

function _scheduleWatchdog(ms) {
  _clearWatchdog()
  _watchdog = setTimeout(() => {
    console.warn('[tts] watchdog fired; forcing stop & retryNext')
    _stopOS()
    _resetState()
    _playNext()
  }, Math.max(1500, ms * 1.6))
}

function _playNext() {
  if (!_enabled) return
  if (_speaking) return
  if (_queue.length === 0) return

  const item = _queue.shift()
  _current = item
  _speaking = true

  const opts = {
    ...DEFAULTS,
    ...(item?.opts || {}),
    // ensure callbacks override
    onStart: () => {
      // Audio already initialized; noop
    },
    onDone: () => {
      _clearWatchdog()
      _speaking = false
      _current = null
      _retryCount = 0
      item?.resolve?.()
      // play next
      setTimeout(_playNext, 10)
    },
    onStopped: () => {
      // Called when Speech.stop() was invoked
      _clearWatchdog()
      _speaking = false
      const wasCurrent = _current === item
      _current = null
      if (wasCurrent) {
        // do not resolve promise; it has been interrupted
        item?.reject?.(new Error('stopped'))
      }
      setTimeout(_playNext, 10)
    },
    onError: (e) => {
      console.warn('[tts] onError:', e?.message || e)
      _clearWatchdog()
      _speaking = false
      const wasCurrent = _current === item
      _current = null
      if (wasCurrent) {
        if (_retryCount < 1) {
          _retryCount++
          // re-init audio + requeue in front
          _initialized = false
          initAudio().finally(() => {
            _queue.unshift(item)
            setTimeout(_playNext, 60)
          })
          return
        }
        item?.reject?.(e instanceof Error ? e : new Error(String(e)))
      }
      setTimeout(_playNext, 10)
    },
  }

  try {
    const speakText = String(item.text ?? '')
    const ms = estimateDurationMs(speakText, opts.rate)
    _scheduleWatchdog(ms)
    Speech.speak(speakText, opts)
  } catch (e) {
    console.warn('[tts] speak failed:', e?.message || e)
    _resetState()
    item?.reject?.(e instanceof Error ? e : new Error(String(e)))
    setTimeout(_playNext, 10)
  }
}

/** Public API **/

export async function setEnabled(enabled) {
  _enabled = !!enabled
  if (!_enabled) {
    clear()
    _stopOS()
  }
}

export function setDefaults(newDefaults = {}) {
  DEFAULTS = { ...DEFAULTS, ...newDefaults }
}

export function isSpeaking() {
  return _speaking
}

export async function stop() {
  _queue = []
  _stopOS()
  _resetState()
}

// Clear queue but don't stop current
export function clear() {
  _queue = []
}

// Enqueue (FIFO). Returns a promise resolved on finish.
export async function speak(text, opts = {}) {
  await initAudio()

  // Optional dedupe by key (avoid repeating same message in short window)
  const now = Date.now()
  const key = opts?.key || text
  if (key && _lastKey === key && (now - _lastKeyAt) < (opts?.dedupeMs ?? 1200)) {
    return Promise.resolve('deduped')
  }
  _lastKey = key
  _lastKeyAt = now

  return new Promise((resolve, reject) => {
    _queue.push({ text, opts, resolve, reject })
    _playNext()
  })
}

// Flush current (stop) and say this immediately
export async function sayNow(text, opts = {}) {
  await initAudio()
  return new Promise((resolve, reject) => {
    try {
      // hard-stop current and flush queue
      _stopOS()
      _resetState()
      _queue = [{ text, opts, resolve, reject }]
      _playNext()
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

// ObstacleDetection에서 사용하는 flushSpeak는 sayNow와 동일
export async function flushSpeak(text, opts = {}) {
  return sayNow(text, opts)
}

// Convenience helpers for common patterns
export async function guide(text) {
  return speak(text, { rate: 0.98, key: 'guide:' + text })
}

export async function alert(text) {
  // make alerts slightly slower for clarity
  return sayNow(text, { rate: 0.9, key: 'alert:' + text })
}

// Auto stop on app background to avoid system kills causing hangs
AppState.addEventListener('change', (s) => {
  if (s === 'background') {
    // Graceful stop to prevent half-way cuts
    stop()
  }
})

export default {
  speak,
  sayNow,
  flushSpeak,  // ObstacleDetection에서 사용
  stop,
  clear,
  isSpeaking,
  setEnabled,
  setDefaults,  // 누락된 함수 추가
  guide,
  alert,
}