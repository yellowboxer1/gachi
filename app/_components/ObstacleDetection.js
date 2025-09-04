// ObstacleDetection.js
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Vibration, AppState } from 'react-native';
import { Camera, useCameraDevices, useCameraPermission } from 'react-native-vision-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';
import tts from './ttsService';

// ======================== Endpoint Resolver (ngrok) ========================
const toWs = (base) => base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
const pick = (...args) => args.find(v => typeof v === 'string' && v.trim().length > 0);

function resolveWsUrl(propUrl) {
  const extra = Constants?.expoConfig?.extra || Constants?.manifest?.extra || {};
  const viaBase = (base) => base ? `${toWs(base).replace(/\/$/,'')}/ws` : null;
  const withReplace = (u) => u ? (u.includes('?') ? `${u}&replace=1` : `${u}?replace=1`) : null;
  return pick(
      withReplace(propUrl),
      withReplace(globalThis.__OD_WS_URL__),
      withReplace(viaBase(globalThis.__OD_BASE__)),
      withReplace(extra.DET_WS),
      withReplace(viaBase(extra.DET_BASE)),
      withReplace('wss://266514037759.ngrok-free.app/ws')
  );
}

// ======================== Config ========================
const FRAME_INTERVAL = 1200;           // 프레임 전송 간격
const PING_INTERVAL_MS = 80000;        // ping 주기
const PONG_TIMEOUT_MS = 16000;         // pong 타임아웃(누적은 아래 MAX로 판단)
const MAX_MISSED_PONGS = 3;
const STALE_RESULT_MS = 4000;          // 최근 수신 이후 이 시간 넘으면 보간/멘트 중지
const IGNORE_BOTTOM_RATIO = 0;         // 필요시 하단 ROI 무시 비율
const MIN_GREEN_SECONDS = 7;           // <7초면 진입 금지

// ======================== Traffic Light ========================
const TL = { DETECTING_1:-2, DETECTING_2:-1, NONE:0, GREEN_INIT:1, RED:2, GREEN_GO:3, YELLOW:4, GREEN_BLINK:5 };
const TL_COOLDOWN_MS = 2500;

// ===== 안정화(오탐 억제) =====
const STABILITY_WINDOW = 6;
const MIN_CONSISTENT_TL = 3;
const MIN_CONSISTENT_CROSSWALK = 3;

// ====== TTS 우선순위 규칙 ======
const TTS_PRI = {
  obstacleHigh: 96,
  obstacle: 95,
  bf: 93,
  stairs: 92,
  warn: 90,
  nav: 60,
  ui: 40,
};

// ======================== BF (Barrier-Free) 메시지 맵 ========================
const BF_MESSAGES = {
  stair_normal: "계단이 있습니다. 발을 조심하세요.",
  stair_broken: "파손된 계단이 있습니다. 매우 주의하세요.",
  steepramp: "급경사로가 있습니다. 난간을 잡고 이동하세요.",
  flatness_A: "바닥이 매우 평탄합니다.",
  flatness_B: "바닥이 비교적 평탄합니다.",
  flatness_C: "바닥이 고르지 않습니다. 주의하세요.",
  flatness_D: "바닥이 많이 고르지 않습니다. 천천히 이동하세요.",
  flatness_E: "바닥이 매우 고르지 않습니다. 매우 주의하세요.",
  brailleblock_dot: "점자 블록(점형)이 감지되었습니다. 점자 블록을 따라 이동하세요.",
  brailleblock_line: "점자 블록(선형)이 감지되었습니다. 점자 블록을 따라 이동하세요.",
  brailleblock_dot_broken: "점자 블록(점형)이 파손되어 있습니다. 주의하세요.",
  brailleblock_line_broken: "점자 블록(선형)이 파손되어 있습니다. 주의하세요.",
  outcurb_rectangle: "연석이 있습니다. 단차에 유의하세요.",
  outcurb_slide: "경사 연석이 있습니다. 미끄럼과 단차에 주의하세요.",
  outcurb_rectangle_broken: "연석이 파손되어 있습니다. 매우 주의하세요.",
  sidegap_in: "실내 문턱이 있습니다. 걸림에 주의하세요.",
  sidegap_out: "실외 문턱이 있습니다. 걸림에 주의하세요.",
  sewer_cross: "배수구(격자)가 있습니다. 발 빠짐에 주의하세요.",
  sewer_line: "배수구(선형)가 있습니다. 발 빠짐에 주의하세요.",
  continuity_manhole: "맨홀이 있습니다. 발 빠짐에 주의하세요.",
  planecrosswalk_normal: "횡단보도가 있습니다.",
  planecrosswalk_broken: "파손된 횡단보도가 있습니다. 주의해서 건너세요.",
  ramp_yes: "경사로가 있습니다.",
  ramp_no: "경사로가 없습니다. 단차 가능성에 주의하세요.",
  pillar: "기둥이 전방에 있습니다. 충돌에 주의하세요.",
  wall: "벽이 전방에 있습니다. 충돌에 주의하세요.",
  stone: "돌이 전방에 있습니다. 걸림에 주의하세요.",
  bump_slow: "과속방지턱이 있습니다. 발을 조심하세요.",
  tierbump: "단차 방지턱이 있습니다. 걸림에 주의하세요.",
};

function bfMessageFor(key) {
  const k = String(key || '').replace(/^bf::/, '');
  return BF_MESSAGES[k] || null;
}

// '주의!' 프리픽스 보장
function ensureCautionPrefix(msg = '') {
  const s = String(msg).trim();
  if (!s) return s;
  if (s.startsWith('주의!') || s.startsWith('긴급!')) return s;
  return `주의! ${s}`;
}

// ======================== Helpers ========================
// 서버 상태(가능: 숫자코드/문자/객체) → 정규화된 신호등 기본상태
function normalizeTrafficLightState(data){
  const tlObj = data?.traffic_light;
  if (tlObj && (tlObj.m1_color === 'red' || tlObj.m1_color === 'green' || tlObj.m1_color == null)) {
    if (tlObj.m1_color === 'red') return TL.RED;
    if (tlObj.m1_color === 'green') return TL.GREEN_GO; // 기본 green(세부 분류는 파생 단계에서)
    return TL.DETECTING_1; // m1이 아직 없으면 검출중 취급
  }
  const sNum = (typeof data?.traffic_light_state === 'number') ? data.traffic_light_state : null;
  if (sNum != null) return sNum;

  const f = Array.isArray(data?.special_features) ? data.special_features.find(x=>x?.type==='traffic_light') : null;
  if (f) {
    const st = (typeof f.state === 'number') ? f.state : String(f.state ?? '').toLowerCase();
    if (st === 'red' || st === TL.RED) return TL.RED;
    if (st === 'green' || st === 'go' || st === TL.GREEN_GO) return TL.GREEN_GO;
    if (st === 'none' || st === TL.NONE) return TL.NONE;
    return TL.DETECTING_1;
  }
  return null;
}

function normSec(v){
  if (typeof v === 'string'){
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return null;
    return v.toLowerCase().includes('ms') ? Math.round(n/1000) : Math.round(n);
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v > 120 ? Math.round(v/1000) : Math.round(v);
  return null;
}

function extractRemainingSeconds(data){
  if (data?.traffic_light && Number.isFinite(data.traffic_light.m2_seconds)) return Math.round(data.traffic_light.m2_seconds);
  if (Number.isFinite(data?.m2_seconds)) return Math.round(data.m2_seconds);

  const item = Array.isArray(data?.special_features)
    ? data.special_features.find(x => x?.type === 'traffic_light_seconds')
    : null;
  if (item && Number.isFinite(item.seconds)) return Math.round(item.seconds);

  const keys = ['traffic_light_remaining','remaining_time','remain_time','remaining','time_remaining','time_left','sec_left'];
  for (const k of keys){
    const v = data?.[k]; const n = normSec(v); if (n!=null) return n;
  }
  return null;
}

function colorByLevel(level){
  switch(level){
    case 'critical': return '#FF0000';
    case 'high': return '#FF6600';
    case 'medium': return '#FFAA00';
    case 'low': return '#00AA00';
    default: return '#00FF00';
  }
}

const pushHist = (arr, v, max) => { arr.push(v); if (arr.length > max) arr.shift(); };
const majority = (arr) => {
  const m = new Map();
  arr.forEach(v => m.set(v, (m.get(v)||0)+1));
  let best = null, cnt = 0;
  m.forEach((c, k) => { if (c > cnt) { cnt = c; best = k; }});
  return { value: best, count: cnt, total: arr.length };
};
const stableBool = (arr, need) => (arr.filter(Boolean).length >= need);

// 서버 원시 state + 초 → UI용 상태로 정규화(<7초면 진입 금지로 GREEN_BLINK)
function deriveTlUiState(rawState, remainSec) {
  if (rawState == null) return null;
  if (rawState === TL.RED) return TL.RED;
  if (rawState === TL.NONE) return TL.NONE;
  if (rawState === TL.GREEN_GO || rawState === TL.GREEN_INIT || rawState === TL.GREEN_BLINK) {
    if (typeof remainSec === 'number') {
      return (remainSec < MIN_GREEN_SECONDS) ? TL.GREEN_BLINK : TL.GREEN_GO;
    }
    return TL.GREEN_INIT;
  }
  return rawState;
}

// ======================== Component ========================
const ObstacleDetection = ({ isNavigating, userLocation, minimal = true, autoStart = false, wsUrl: propWsUrl, onHeadingChange }) => {
  // 단일 인스턴스 가드
  const [isPrimary, setIsPrimary] = useState(false);
  useEffect(() => {
    if (!globalThis.__OD_PRIMARY__) { 
      globalThis.__OD_PRIMARY__ = true; 
      setIsPrimary(true); 
    }
    return () => { 
      if (isPrimary) delete globalThis.__OD_PRIMARY__; 
    };
  }, [isPrimary]);

  // Camera - Hook 규칙 준수
  const devices = useCameraDevices();
  const device = useMemo(() => (devices?.back) ? devices.back :
    (Array.isArray(devices) ? devices.find(d=>d?.position==='back') : null), [devices]);
  
  const { hasPermission, requestPermission } = useCameraPermission();
  const [cameraReady, setCameraReady] = useState(false);
  const cameraRef = useRef(null);

  const handlePermissionRequest = useCallback(async () => {
    if (hasPermission === false) {
      try { await requestPermission(); } catch (error) { console.warn('Permission request failed:', error); }
    }
  }, [hasPermission, requestPermission]);

  useEffect(() => { handlePermissionRequest(); }, [handlePermissionRequest]);

  // AppState
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      const prev = appStateRef.current; 
      appStateRef.current = s;
      if (s === 'active' && /inactive|background/.test(prev)) {
        try { wsRef.current?.close(); } catch {}
      } else if (/inactive|background/.test(s)) {
        stopKeepAlive();
        try { wsRef.current?.close(); } catch {}
      }
    });
    return () => sub.remove();
  }, []);

  // Active guard
  const instanceId = useRef(Math.random().toString(36).slice(2));
  const isActive = useCallback(() => globalThis.__OD_ACTIVE__?.id === instanceId.current, []);
  
  useEffect(() => {
    if (!isPrimary) return;
    const prev = globalThis.__OD_ACTIVE__;
    if (prev?.cleanup) { try { prev.cleanup(); } catch {} }
    
    const cleanup = () => {
      try { frameIntervalRef.current && clearInterval(frameIntervalRef.current); } catch {}
      frameIntervalRef.current = null;
      try { keepAliveTimerRef.current && clearInterval(keepAliveTimerRef.current); } catch {}
      keepAliveTimerRef.current = null;
      try { healthTimerRef.current && clearInterval(healthTimerRef.current); } catch {}
      healthTimerRef.current = null;
      try { localTickTimerRef.current && clearInterval(localTickTimerRef.current); } catch {}
      localTickTimerRef.current = null;
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
      try { tts.stop?.(); } catch {}
      Vibration.cancel();
    };
    
    globalThis.__OD_ACTIVE__ = { id: instanceId.current, cleanup };
    return () => { 
      if (globalThis.__OD_ACTIVE__?.id === instanceId.current) {
        delete globalThis.__OD_ACTIVE__; 
      }
      cleanup(); 
    };
  }, [isPrimary]);

  // State
  const [isDetecting, setIsDetecting] = useState(Boolean(autoStart));
  const [dangerLevel, setDangerLevel] = useState('safe');
  const [lastWarning, setLastWarning] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [tlState, setTlState] = useState(null);
  const [tlRemain, setTlRemain] = useState(null);
  const [sentCount, setSentCount] = useState(0);
  const [recvCount, setRecvCount] = useState(0);
  const [lastFrameAt, setLastFrameAt] = useState(null);
  const [lastB64, setLastB64] = useState(0);
  const [obstacles, setObstacles] = useState([]);
  const [specials, setSpecials] = useState({ crosswalk:false, stairsUp:false, stairsDown:false });

  // Refs
  const connectingRef = useRef(false);
  const wsRef = useRef(null);
  const wsUrlRef = useRef(resolveWsUrl(propWsUrl));
  const frameIntervalRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const busyRef = useRef(false);
  const lastWarningTimeRef = useRef(0);
  const lastTLStateRef = useRef(null);
  const lastTLAtRef = useRef(0);
  const reconnectAttemptRef = useRef(0);

  // 안정화 히스토리
  const histRef = useRef({ tl: [], crosswalk: [] });
  const lastStableTLRef = useRef(null);
  const lastStableCrosswalkRef = useRef(false);

  // ping/pong
  const lastRxAtRef = useRef(Date.now());
  const lastPongAtRef = useRef(Date.now());
  const missedPongsRef = useRef(0);

  // 소켓 토큰(레이스 컷)
  const socketIdRef = useRef(0);

  // 프레임 식별/최신성
  const frameSeqRef = useRef(0);
  const lastAcceptedSeqRef = useRef(-1);
  const [lastAcceptedSeq, setLastAcceptedSeq] = useState(-1);

  // keep-alive
  const keepAliveTimerRef = useRef(null);
  const healthTimerRef = useRef(null);

  // 로컬 카운트다운
  const localRemainRef = useRef(null);
  const localTickTimerRef = useRef(null);

  // 안전 전송
  const wsSendSafe = useCallback((ws, obj) => {
    try {
      if (!ws) return false;
      if (ws !== wsRef.current) return false;
      if (ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(obj));
      return true;
    } catch (e) {
      const msg = String(e?.message || e);
      if (/client is null/i.test(msg)) {
        console.log('[ws] benign send race (client is null)');
      } else {
        console.log('[ws] send error:', msg);
      }
      return false;
    }
  }, []);

  // TL 안내 (TTS/햅틱)
  const announceTrafficLight = useCallback((state, remainSec) => {
    const now = Date.now();
    if (lastTLStateRef.current === state && (now - lastTLAtRef.current) < TL_COOLDOWN_MS) return;
    lastTLStateRef.current = state; 
    lastTLAtRef.current = now;
    if (!isNavigating) return;

    if (state === TL.NONE){
      tts.flushSpeak('횡단보도의 신호등이 없습니다. 조심히 건너세요.', { priority: TTS_PRI.obstacle, type: 'obstacle' });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    if (state === TL.RED){
      tts.flushSpeak('주의! 빨간불입니다. 잠시만 기다려주세요.', { priority: TTS_PRI.obstacle, type: 'obstacle' });
      Vibration.vibrate([0,400,150,400]);
      return;
    }
    if (state === TL.GREEN_BLINK){
      tts.flushSpeak('주의! 신호가 곧 바뀝니다. 진입하지 말고 다음 신호를 기다리세요.', { priority: TTS_PRI.obstacleHigh, type: 'obstacle' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Vibration.vibrate([0,300,120,300]);
      return;
    }
    if (state === TL.GREEN_GO){
      const msg = (typeof remainSec === 'number') ? `초록불입니다. 지금 건널 수 있습니다. 남은 시간 약 ${remainSec}초.` : '초록불입니다. 지금 건널 수 있습니다.';
      tts.flushSpeak(msg, { priority: TTS_PRI.obstacle, type: 'obstacle' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    if (state === TL.GREEN_INIT){
      if (typeof remainSec !== 'number'){
        tts.flushSpeak('초록불입니다. 주의해서 건너세요.', { priority: TTS_PRI.warn, type: 'obstacle' });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      }
      tts.flushSpeak('주의! 신호가 곧 바뀝니다. 진입하지 말고 다음 신호를 기다리세요.', { priority: TTS_PRI.obstacleHigh, type: 'obstacle' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Vibration.vibrate([0,300,120,300]);
      return;
    }
  }, [isNavigating]);

  // Detection result 처리
  const handleDetectionResult = useCallback((data) => {
    if (data?.error){ 
      setConnectionError(data.error); 
      return; 
    }
    const now = Date.now();
    lastRxAtRef.current = now;

    setDangerLevel(data?.danger_level || 'safe');

    const feats = Array.isArray(data?.special_features) ? data.special_features : [];
    const flags = {
      crosswalk: !!feats.find(f => f?.type === 'crosswalk') || !!data?.crosswalk,
      stairsUp:  !!feats.find(f => f?.type === 'stairs_up'),
      stairsDown:!!feats.find(f => f?.type === 'stairs_down'),
    };
    setSpecials(flags);

    const obs = Array.isArray(data?.obstacles) ? data.obstacles : [];
    setObstacles(obs);

    pushHist(histRef.current.crosswalk, flags.crosswalk, STABILITY_WINDOW);

    // 신호등 상태 + 잔여초
    const rawState = normalizeTrafficLightState(data);
    const remainSec = extractRemainingSeconds(data);
    if (rawState !== null && rawState !== undefined) pushHist(histRef.current.tl, rawState, STABILITY_WINDOW);

    const crosswalkStable = stableBool(histRef.current.crosswalk, MIN_CONSISTENT_CROSSWALK);
    const tlMaj = majority(histRef.current.tl);
    const rawStable = tlMaj.count >= MIN_CONSISTENT_TL ? tlMaj.value : null;
    const derived = deriveTlUiState(rawStable, remainSec);

    if (derived !== null) {
      setTlState(derived);
      const sec = (typeof remainSec === 'number') ? remainSec : null;
      setTlRemain(sec);
      // 로컬 카운트다운 초기화
      localRemainRef.current = sec;
    }

    // 교차로 안정화된 경우에만 안내
    if (derived !== null && crosswalkStable) {
      const shouldAnnounce = (lastStableTLRef.current !== derived) || (lastStableCrosswalkRef.current !== crosswalkStable);
      if (shouldAnnounce) {
        announceTrafficLight(derived, (typeof remainSec === 'number' ? remainSec : null));
        lastStableTLRef.current = derived;
        lastStableCrosswalkRef.current = crosswalkStable;
      }
    }

    // 위험도 햅틱
    if (data?.danger_level === 'critical'){
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      Vibration.vibrate([0,300,100,300,100,300]);
    } else if (data?.danger_level === 'high'){
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Vibration.vibrate([0,200,100,200,100,200]);
    } else if (data?.danger_level === 'medium'){
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Vibration.vibrate([0,150,100,150]);
    }

    // 내비 중일 때만 추가 안내
    if (isNavigating) {
      if (flags.stairsUp) {
        try { tts.flushSpeak(ensureCautionPrefix('오르막 계단이 있습니다.'), { priority: TTS_PRI.stairs, type: 'obstacle' }); } catch {}
        Vibration.vibrate([0,200,100,200]);
      }
      if (flags.stairsDown) {
        try { tts.flushSpeak(ensureCautionPrefix('내리막 계단이 있습니다. 주의하세요.'), { priority: TTS_PRI.stairs, type: 'obstacle' }); } catch {}
        Vibration.vibrate([0,300,100,300]);
      }
      if (flags.crosswalk) { 
        try { tts.speak('횡단보도입니다.', { priority: 80, type: 'obstacle', dedupeMs: 2500 }); } catch {} 
      }
    }

    // Barrier-Free 특성 안내 (서버는 메시지 없이 type/severity만 보내는 걸 권장)
    for (const f of feats) {
      if (typeof f?.type === 'string' && f.type.startsWith('bf::')) {
        const msg = bfMessageFor(f.type);
        const sev = f?.severity || 'info';

        if (msg && isNavigating) {
          const speakMsg = (sev === 'danger' || sev === 'warn')
            ? ensureCautionPrefix(msg)
            : msg;

          try {
            const pri = (sev === 'danger') ? TTS_PRI.obstacleHigh
                      : (sev === 'warn')   ? TTS_PRI.bf
                      : TTS_PRI.ui;
            tts.flushSpeak(speakMsg, { priority: pri, type: 'obstacle', dedupeMs: 3000 });
          } catch {}

          if (sev === 'danger') { 
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); 
            Vibration.vibrate([0,320,120,320]); 
          } else if (sev === 'warn') { 
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); 
            Vibration.vibrate([0,220,120,220]); 
          }
        }
      }
    }

    // 서버 warnings[] (문자 멘트가 여전히 온다면 안전하게 처리)
    if (isNavigating && Array.isArray(data?.warnings)) {
      for (const w of data.warnings) {
        if (w && typeof w === 'string') {
          try { tts.flushSpeak(ensureCautionPrefix(w), { priority: TTS_PRI.obstacle, type: 'obstacle', dedupeMs: 3000 }); } catch {}
        }
      }
    }

    if (isNavigating && data?.priority_warning && now - lastWarningTimeRef.current > 2000){
      tts.flushSpeak(ensureCautionPrefix(data.priority_warning), { priority: TTS_PRI.obstacleHigh, type: 'obstacle' });
      setLastWarning(data.priority_warning);
      lastWarningTimeRef.current = now;
    }

    // 🔧 onHeadingChange 콜백 호출 (기기 방향 정보가 있다면)
    if (typeof onHeadingChange === 'function' && data?.device_heading) {
      try { onHeadingChange(data.device_heading); } catch (error) { console.warn('onHeadingChange error:', error); }
    }
  }, [announceTrafficLight, isNavigating, onHeadingChange]);

  // 로컬 카운트다운: 서버 응답 사이에 안전 보간
  useEffect(() => {
    if (localTickTimerRef.current) {
      clearInterval(localTickTimerRef.current);
      localTickTimerRef.current = null;
    }
    localTickTimerRef.current = setInterval(() => {
      const now = Date.now();
      const isFresh = (now - lastRxAtRef.current) <= STALE_RESULT_MS;
      if (!isFresh) return;

      // 교차로 안정화 전이면 멘트/보간 금지
      const crosswalkStable = stableBool(histRef.current.crosswalk, MIN_CONSISTENT_CROSSWALK);
      if (!crosswalkStable) return;

      if (typeof localRemainRef.current === 'number' && localRemainRef.current > 0) {
        localRemainRef.current = Math.max(0, localRemainRef.current - 1);
        setTlRemain(localRemainRef.current);

        // 로컬 잔여초 기반 파생 상태 재계산
        const tlMaj = majority(histRef.current.tl);
        const rawStable = tlMaj.count >= MIN_CONSISTENT_TL ? tlMaj.value : null;
        const derived = deriveTlUiState(rawStable, localRemainRef.current);
        if (derived != null) {
          const shouldAnnounce = (lastStableTLRef.current !== derived);
          setTlState(derived);
          if (shouldAnnounce) {
            announceTrafficLight(derived, localRemainRef.current);
            lastStableTLRef.current = derived;
          }
        }
      }
    }, 1000);
    return () => {
      if (localTickTimerRef.current) {
        clearInterval(localTickTimerRef.current);
        localTickTimerRef.current = null;
      }
    };
  }, [announceTrafficLight]);

  // ===== WebSocket 연결/유지 =====
  const startKeepAlive = useCallback(() => {
    stopKeepAlive();
    keepAliveTimerRef.current = setInterval(() => {
      wsSendSafe(wsRef.current, { type:'ping', t:'ping', ts: Date.now() });
    }, PING_INTERVAL_MS);
    healthTimerRef.current = setInterval(() => {
      const now = Date.now();
      const gap = now - lastPongAtRef.current;
      if (gap > PONG_TIMEOUT_MS) {
        missedPongsRef.current += 1;
        console.log(`[ws] pong 미수신 ${missedPongsRef.current}회`);
        if (missedPongsRef.current >= MAX_MISSED_PONGS) {
          console.log('[ws] pong 누락 누적 -> 재연결');
          try { wsRef.current?.close(); } catch {}
        }
      }
    }, 5000);
  }, [wsSendSafe]);

  const stopKeepAlive = useCallback(() => {
    if (keepAliveTimerRef.current){ clearInterval(keepAliveTimerRef.current); keepAliveTimerRef.current = null; }
    if (healthTimerRef.current){ clearInterval(healthTimerRef.current); healthTimerRef.current = null; }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!isDetecting) return;
    const attempt = Math.min(reconnectAttemptRef.current + 1, 6);
    reconnectAttemptRef.current = attempt;
    const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
    if (!reconnectTimeoutRef.current){
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connectWebSocket();
      }, delay);
      console.log(`[ws] 재연결 예약 (${attempt}) ${Math.round(delay/1000)}s 후`);
    }
  }, [isDetecting]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current){ clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
  }, []);

  // ===== 프레임 캡처 & 전송 =====
  const captureAndSendFrame = useCallback(async () => {
    if (!isDetecting) return;
    if (!cameraReady || !cameraRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (busyRef.current) return;

    busyRef.current = true;
    try {
      // 사진 캡처 (속도 우선)
      const photo = await cameraRef.current.takePhoto({
        qualityPrioritization: 'speed',
        skipMetadata: true,
      });

      // 파일 → base64
      const b64 = await FileSystem.readAsStringAsync(photo.path, { encoding: FileSystem.EncodingType.Base64 });
      setLastB64(b64.length);

      // (선택) 리사이즈/압축 예시
      // const manip = await ImageManipulator.manipulateAsync(photo.path, [{ resize: { width: 640 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG });
      // const b64 = await FileSystem.readAsStringAsync(manip.uri, { encoding: FileSystem.EncodingType.Base64 });

      const seq = ++frameSeqRef.current;
      const payload = {
        type: 'frame',
        seq,
        ts: Date.now(),
        image_b64: b64,
        meta: {
          ignore_bottom_ratio: IGNORE_BOTTOM_RATIO,
          nav: Boolean(isNavigating),
        }
      };
      const ok = wsSendSafe(wsRef.current, payload);
      if (ok) {
        setSentCount((c)=>c+1);
        setLastFrameAt(Date.now());
        setLastAcceptedSeq(seq);
        lastAcceptedSeqRef.current = seq;
      }
    } catch (e) {
      console.warn('capture/send error:', e?.message || e);
    } finally {
      busyRef.current = false;
    }
  }, [cameraReady, isDetecting, isNavigating, wsSendSafe]);

  // ===== 소켓 연결 함수 =====
  const connectWebSocket = useCallback(() => {
    if (!isPrimary) return;
    if (connectingRef.current) return;
    const url = wsUrlRef.current;
    if (!url) {
      setConnectionError('WS URL 미지정');
      return;
    }
    connectingRef.current = true;
    clearReconnectTimer();

    try {
      const id = ++socketIdRef.current;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (id !== socketIdRef.current) { try { ws.close(); } catch {} return; }
        connectingRef.current = false;
        setIsConnected(true);
        setConnectionError(null);
        missedPongsRef.current = 0;
        lastPongAtRef.current = Date.now();
        startKeepAlive();

        // 전송 루프 시작
        if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = setInterval(() => {
          captureAndSendFrame();
        }, FRAME_INTERVAL);

        console.log('[ws] open', url);
      };

      ws.onmessage = (ev) => {
        if (id !== socketIdRef.current) return;
        try {
          const msg = JSON.parse(ev.data);
          if (msg?.t === 'pong' || msg?.type === 'pong') {
            lastPongAtRef.current = Date.now();
            missedPongsRef.current = 0;
            return;
          }
          // 일반 detection 응답
          setRecvCount((c)=>c+1);
          handleDetectionResult(msg);
        } catch (e) {
          // 서버가 텍스트 아닌 바이너리/비JSON 보내는 경우 무시
        }
      };

      ws.onerror = (e) => {
        if (id !== socketIdRef.current) return;
        console.log('[ws] error:', e?.message || e);
        setConnectionError(String(e?.message || 'WS error'));
      };

      ws.onclose = () => {
        if (id !== socketIdRef.current) return;
        console.log('[ws] close');
        setIsConnected(false);
        connectingRef.current = false;
        stopKeepAlive();
        try { frameIntervalRef.current && clearInterval(frameIntervalRef.current); } catch {}
        frameIntervalRef.current = null;
        scheduleReconnect();
      };
    } catch (e) {
      connectingRef.current = false;
      setConnectionError(String(e?.message || e));
      scheduleReconnect();
    }
  }, [isPrimary, clearReconnectTimer, startKeepAlive, stopKeepAlive, scheduleReconnect, captureAndSendFrame, handleDetectionResult]);

  const disconnectWebSocket = useCallback(() => {
    try { wsRef.current?.close(); } catch {}
  }, []);

  // 탐지 on/off 제어 (autoStart 고려)
  useEffect(() => {
    setIsDetecting(Boolean(autoStart) || Boolean(isNavigating));
  }, [autoStart, isNavigating]);

  useEffect(() => {
    if (!isPrimary) return;
    if (isDetecting) {
      connectWebSocket();
    } else {
      disconnectWebSocket();
      stopKeepAlive();
      try { frameIntervalRef.current && clearInterval(frameIntervalRef.current); } catch {}
      frameIntervalRef.current = null;
    }
    return () => {};
  }, [isPrimary, isDetecting, connectWebSocket, disconnectWebSocket, stopKeepAlive]);

  // UI 렌더링 (HUD 없이 카메라만)
  if (!isPrimary) return null;

  if (hasPermission !== true){
    return (
      <View style={styles.fill}>
        <View style={styles.center}>
          <Text style={styles.errorText}>카메라 권한이 필요합니다.</Text>
          <TouchableOpacity onPress={handlePermissionRequest} style={styles.permBtn}>
            <Text style={{ color:'#fff', fontWeight:'bold' }}>권한 허용하기</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!device){
    return (
      <View style={styles.fill}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#00D8FF" />
          <Text style={styles.mono}>카메라 장치를 찾는 중...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.fill} pointerEvents="box-none">
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        photo={true}
        video={false}
        enableZoomGesture={false}
        onInitialized={()=>{
          const available = !!(cameraRef.current && typeof cameraRef.current.takePhoto === 'function');
          if (!available) {
            console.error('[OD] VisionCamera is mounted, but takePhoto is not a function (wrong build?)');
          }
          setCameraReady(true);
        }}
        onError={(e)=>console.warn('📷 VisionCamera error:', e)}
      />
      {/* HUD/패널 비노출: TTS/햅틱만 동작 */}
    </View>
  );
};

// 스타일 정의
const styles = StyleSheet.create({
  fill: { flex:1, backgroundColor:'#000' },
  center: { flex:1, justifyContent:'center', alignItems:'center' },
  errorText: { color:'#FF6666', fontSize:13, marginVertical:4 },
  permBtn: { marginTop:10, padding:10, backgroundColor:'#007AFF', borderRadius:8 },
  mono: { color:'#fff', marginTop:8, textAlign:'center' },
});

export default ObstacleDetection;
