import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Vibration, AppState } from 'react-native';
import { Camera, useCameraDevices, useCameraPermission } from 'react-native-vision-camera';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';

// ======================== Config ========================
const DEFAULT_WS_URL = 'wss://a75dd9d886af.ngrok-free.app/ws';
const getWsUrl = (propUrl) => propUrl || globalThis.__OD_WS_URL__ || DEFAULT_WS_URL;

const FRAME_INTERVAL = 800; // ~1.25fps
const SPEECH_OPTS = { language: 'ko-KR' };

// Keep-alive / Watchdog
const PING_INTERVAL_MS = 20000;         // 20s 마다 ping
const PONG_TIMEOUT_MS = 45000;          // 45s 내 pong 미수신 -> miss 1회
const MAX_MISSED_PONGS = 3;             // 3회 연속 pong 미수신 시 재연결

// ======================== Traffic Light ========================
const TL = { DETECTING_1:-2, DETECTING_2:-1, NONE:0, GREEN_INIT:1, RED:2, GREEN_GO:3, YELLOW:4, GREEN_BLINK:5 };
const TL_LABEL = {
  [-2]:'신호등 검출 진행 중', [-1]:'신호등 검출 진행 중', [0]:'신호등 없음', [1]:'초록불 감지(대기)',
  [2]:'빨간불(대기)', [3]:'초록불(건너도 됨)', [4]:'노란불(무시)', [5]:'초록불 점멸(대기)',
};
const TL_COOLDOWN_MS = 2500;

// ===== 안정화(오탐 억제) 파라미터 =====
const STABILITY_WINDOW = 6;
const MIN_CONSISTENT_TL = 3;
const MIN_CONSISTENT_CROSSWALK = 3;

// ======================== Helpers ========================
function normalizeTrafficLightState(data){
  const state = (typeof data?.traffic_light_state === 'number') ? data.traffic_light_state
    : (() => {
        const f = Array.isArray(data?.special_features) ? data.special_features.find(x=>x?.type==='traffic_light') : null;
        if (!f) return null;
        if (typeof f.state === 'number') return f.state;
        const s = String(f.state ?? '').toLowerCase();
        if (s === 'red') return TL.RED;
        if (s.includes('blink') || s.includes('flash')) return TL.GREEN_BLINK;
        if (s === 'green_go' || s === 'green' || s === 'go') return TL.GREEN_GO;
        if (s === 'green_init' || s === 'init_green' || s === 'pending') return TL.GREEN_INIT;
        if (s === 'none') return TL.NONE;
        if (s === 'detecting' || s === '') return TL.DETECTING_1;
        return null;
      })();
  return state;
}

 function extractRemainingSeconds(data){
     // 1) 서버 top-level (권장)
     if (Number.isFinite(data?.m2_seconds)) return Math.round(data.m2_seconds);
     // 2) 서버 special_features 항목
     const item = Array.isArray(data?.special_features)
       ? data.special_features.find(x => x?.type === 'traffic_light_seconds')
       : null;
     if (item && Number.isFinite(item.seconds)) return Math.round(item.seconds);
     // 3) 기존 키들도 계속 지원
     const keys = ['traffic_light_remaining','remaining_time','remain_time','remaining','time_remaining','time_left','sec_left'];
     for (const k of keys){
       const v = data?.[k]; const n = normSec(v); if (n!=null) return n;
     }
     return null;
   }
function normSec(v){
  if (typeof v === 'string'){
    const n = parseFloat(v);
    if (Number.isFinite(n)) return v.toLowerCase().includes('ms') ? Math.round(n/1000) : Math.round(n);
    return null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v > 120 ? Math.round(v/1000) : Math.round(v);
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

// ======================== Component ========================
const ObstacleDetection = ({ isNavigating, userLocation, minimal = true, autoStart = true, wsUrl: propWsUrl }) => {
  // 단일 인스턴스 가드
  const [isPrimary, setIsPrimary] = useState(false);
  useEffect(() => {
    if (!globalThis.__OD_PRIMARY__) { globalThis.__OD_PRIMARY__ = true; setIsPrimary(true); }
    return () => { if (isPrimary) delete globalThis.__OD_PRIMARY__; };
  }, [isPrimary]);

  // Camera
  const devices = useCameraDevices();
  const device = useMemo(() => (devices?.back) ? devices.back :
    (Array.isArray(devices) ? devices.find(d=>d?.position==='back') : null), [devices]);
  const { hasPermission, requestPermission } = useCameraPermission();
  const [cameraReady, setCameraReady] = useState(false);
  const cameraRef = useRef(null);
  useEffect(()=>{ if (hasPermission === false) requestPermission().catch(()=>{}); }, [hasPermission, requestPermission]);

  // AppState(백그라운드/포그라운드)
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      const prev = appStateRef.current; appStateRef.current = s;
      if (s === 'active' && /inactive|background/.test(prev)) {
        // 복귀 시 재연결
        try { wsRef.current?.close(); } catch {}
      } else if (/inactive|background/.test(s)) {
        // 백그라운드 진입 시 타이머 일시정지
        stopKeepAlive();
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
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
      Speech.stop(); Vibration.cancel();
    };
    globalThis.__OD_ACTIVE__ = { id: instanceId.current, cleanup };
    return () => { if (globalThis.__OD_ACTIVE__?.id === instanceId.current) delete globalThis.__OD_ACTIVE__; cleanup(); };
  }, [isPrimary]);

  // State
  const [isDetecting, setIsDetecting] = useState(false);
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
  const wsRef = useRef(null);
  const wsUrlRef = useRef(getWsUrl(propWsUrl));
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

  // ping/pong 상태
  const lastRxAtRef = useRef(Date.now());        // 마지막 수신(아무 메시지)
  const lastPongAtRef = useRef(Date.now());      // 마지막 pong 수신
  const missedPongsRef = useRef(0);

  // 🔹 소켓 인스턴스 토큰(레이스 컷)
  const socketIdRef = useRef(0);

  // 🔹 안전 전송: 네이티브 "client is null" 레이스 흡수
  const wsSendSafe = useCallback((ws, obj) => {
    try {
      if (!ws) return false;
      if (ws !== wsRef.current) return false;                    // 최신 인스턴스만
      if (ws.readyState !== WebSocket.OPEN) return false;        // 표준 가드
      ws.send(JSON.stringify(obj));
      return true;
    } catch (e) {
      const msg = String(e?.message || e);
      if (/client is null/i.test(msg)) {
        // 닫힌 소켓으로 보낸 레이스 → 무해, 조용히 무시
        console.log('[ws] benign send race (client is null)');
      } else {
        console.log('[ws] send error:', msg);
      }
      return false;
    }
  }, []);

  // ===== TL 안내 =====
  const announceTrafficLight = useCallback((state, remainSec) => {
    const now = Date.now();
    if (lastTLStateRef.current === state && (now - lastTLAtRef.current) < TL_COOLDOWN_MS) return;
    lastTLStateRef.current = state; lastTLAtRef.current = now;

    if (state === TL.NONE){
      Speech.speak('횡단보도의 신호등이 없습니다. 조심히 건너세요.', SPEECH_OPTS);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    if (state === TL.RED){
      Speech.speak('빨간불입니다. 잠시만 기다려주세요.', SPEECH_OPTS);
      Vibration.vibrate([0,400,150,400]);
      return;
    }
    if (state === TL.GREEN_BLINK){
      Speech.speak('신호가 곧 바뀝니다. 진입하지 말고 다음 신호를 기다리세요.', SPEECH_OPTS);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Vibration.vibrate([0,300,120,300]);
      return;
    }
    if (state === TL.GREEN_GO){
      Speech.speak('초록불입니다. 지금 건널 수 있습니다.', { ...SPEECH_OPTS, rate:1.05, pitch:1.02 });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    if (state === TL.GREEN_INIT){
      if (typeof remainSec !== 'number'){
        Speech.speak('초록불입니다. 주의해서 건너세요.', SPEECH_OPTS);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      }
      Speech.speak('신호가 곧 바뀝니다. 진입하지 말고 다음 신호를 기다리세요.', SPEECH_OPTS);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Vibration.vibrate([0,300,120,300]);
      return;
    }
  }, []);

  // ===== Detection result =====
  const handleDetectionResult = useCallback((data) => {
    if (data?.error){ setConnectionError(data.error); return; }
    setDangerLevel(data?.danger_level || 'safe');

    const feats = Array.isArray(data?.special_features) ? data.special_features : [];
    const flags = {
      crosswalk: !!feats.find(f => f?.type === 'crosswalk'),
      stairsUp:  !!feats.find(f => f?.type === 'stairs_up'),
      stairsDown:!!feats.find(f => f?.type === 'stairs_down'),
    };
    setSpecials(flags);

    const obs = Array.isArray(data?.obstacles) ? data.obstacles : [];
    setObstacles(obs);

    pushHist(histRef.current.crosswalk, flags.crosswalk, STABILITY_WINDOW);

    const s = normalizeTrafficLightState(data);
    const r = extractRemainingSeconds(data);
    if (s !== null && s !== undefined) pushHist(histRef.current.tl, s, STABILITY_WINDOW);

    const crosswalkStable = stableBool(histRef.current.crosswalk, MIN_CONSISTENT_CROSSWALK);
    const tlMaj = majority(histRef.current.tl);
    const tlStable = tlMaj.count >= MIN_CONSISTENT_TL ? tlMaj.value : null;

    if (tlStable !== null) {
      setTlState(tlStable);
      setTlRemain(typeof r === 'number' ? r : null);
    }
    if (tlStable !== null && crosswalkStable) {
      const shouldAnnounce = (lastStableTLRef.current !== tlStable) || (lastStableCrosswalkRef.current !== crosswalkStable);
      if (shouldAnnounce) {
        announceTrafficLight(tlStable, (typeof r === 'number' ? r : null));
        lastStableTLRef.current = tlStable;
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

    if (flags.stairsUp)  { try { Speech.speak('오르막 계단이 있습니다.', SPEECH_OPTS); } catch {} Vibration.vibrate([0,200,100,200]); }
    if (flags.stairsDown){ try { Speech.speak('내리막 계단이 있습니다. 주의하세요.', SPEECH_OPTS); } catch {} Vibration.vibrate([0,300,100,300]); }
    if (flags.crosswalk){ try { Speech.speak('횡단보도입니다.', SPEECH_OPTS); } catch {} }

    const now = Date.now();
    if (data?.priority_warning && now - lastWarningTimeRef.current > 2000){
      Speech.speak(data.priority_warning, { ...SPEECH_OPTS, rate:1.2, pitch: data.danger_level==='critical' ? 1.2 : 1.0 });
      setLastWarning(data.priority_warning);
      lastWarningTimeRef.current = now;
    }
  }, [announceTrafficLight]);

  // ===== WebSocket =====
  const scheduleReconnect = useCallback(() => {
    if (!isDetecting) return;
    const attempt = Math.min(reconnectAttemptRef.current + 1, 6);
    reconnectAttemptRef.current = attempt;
    const delay = Math.min(30000, 1000 * Math.pow(2, attempt)); // cap 30s
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

  // keep-alive: ping & health check (pong 미수신 카운트 기반)
  const keepAliveTimerRef = useRef(null);
  const healthTimerRef = useRef(null);

  const startKeepAlive = useCallback(() => {
    stopKeepAlive();

    // 1) 주기적 ping
    keepAliveTimerRef.current = setInterval(() => {
      wsSendSafe(wsRef.current, { type:'ping', t:'ping', ts: Date.now() });
    }, PING_INTERVAL_MS);

    // 2) pong 감시
    healthTimerRef.current = setInterval(() => {
      const now = Date.now();
      const gap = now - lastPongAtRef.current;
      if (gap > PONG_TIMEOUT_MS) {
        missedPongsRef.current += 1;
        console.log(`[ws] pong 미수신 ${missedPongsRef.current}회`);
        // 서버가 응답 없는 상태가 누적되면 재연결
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

  const connectWebSocket = useCallback(() => {
    if (!isActive() || !isPrimary) {
      console.log('[ws] skip: not active/primary', { active: isActive(), isPrimary });
      return;
    }
    try{
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }

      const url = wsUrlRef.current = getWsUrl(propWsUrl);
      console.log('🔌 WebSocket 연결 시도:', url);

      const ws = new WebSocket(url);
      wsRef.current = ws;

      // 🔹 이 연결만의 토큰(콜백 레이스 방지)
      const myId = ++socketIdRef.current;

      ws.onopen = () => {
        if (ws !== wsRef.current || myId !== socketIdRef.current) return; // 레이스 컷
        console.log('🟢 WebSocket 연결 성공');
        setIsConnected(true);
        setConnectionError(null);
        reconnectAttemptRef.current = 0;
        missedPongsRef.current = 0;
        lastRxAtRef.current = Date.now();
        lastPongAtRef.current = Date.now();
        clearReconnectTimer();
        startKeepAlive();
        setTimeout(() => { try { captureAndSendFrame(); } catch(_){} }, 150);
        if (!minimal){
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Speech.speak('장애물 감지 서버 연결됨', SPEECH_OPTS);
        }
      };

      ws.onmessage = (event) => {
        if (ws !== wsRef.current || myId !== socketIdRef.current) return; // 레이스 컷
        lastRxAtRef.current = Date.now();
        try{
          const data = JSON.parse(event.data);
          const typ = data?.type || data?.t;

          if (typ === 'pong') {
            lastPongAtRef.current = Date.now();
            missedPongsRef.current = 0;
            return;
          }
          setRecvCount(c=>c+1);
          handleDetectionResult(data);
        }catch(e){
          // 텍스트면 pong 처리
          const s = String(event.data || '');
          if (/pong/i.test(s)) {
            lastPongAtRef.current = Date.now();
            missedPongsRef.current = 0;
            return;
          }
          console.warn('📨 메시지 파싱 실패:', e);
        }
      };

      ws.onerror = (e) => {
        if (ws !== wsRef.current || myId !== socketIdRef.current) return; // 레이스 컷
        const msg = e?.message || String(e);
        if (/client is null/i.test(msg)) {
          console.log('[ws] benign error (client is null) — ignore');
        } else {
          console.error('🔴 WebSocket 오류:', msg);
          setConnectionError(`연결 오류: ${msg}`);
        }
      };

      ws.onclose = (ev) => {
        if (ws !== wsRef.current || myId !== socketIdRef.current) return; // 레이스 컷
        console.log('⚪ WebSocket 종료', ev?.code, ev?.reason);
        setIsConnected(false);
        stopKeepAlive();
        scheduleReconnect();
      };
    }catch(e){
      console.error('🔴 WebSocket 생성 오류:', e);
      setConnectionError(`연결 생성 실패: ${e.message}`);
      scheduleReconnect();
    }
  }, [isActive, isDetecting, handleDetectionResult, isPrimary, minimal, propWsUrl, scheduleReconnect, clearReconnectTimer, startKeepAlive, stopKeepAlive]);

  const disconnectWebSocket = useCallback(()=>{
    try{ wsRef.current?.close(); }catch{}
    wsRef.current = null;
    clearReconnectTimer();
    stopKeepAlive();
    setIsConnected(false);
  }, [clearReconnectTimer, stopKeepAlive]);

  // ===== Frame capture via takePhoto =====
  const captureAndSendFrame = useCallback(async ()=>{
    try{
      if (!isDetecting || !cameraReady || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return;
      }
      if (!isActive() || !isPrimary) return;
      if (busyRef.current) return;

      busyRef.current = true;

      const photo = await cameraRef.current.takePhoto({
        qualityPrioritization: 'speed',
        flash: 'off',
        enableShutterSound: false,
        skipMetadata: true,
      });

      const uri = photo?.path?.startsWith('file://') ? photo.path : `file://${photo?.path}`;
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      if (!base64) return;

      setLastB64(base64?.length || 0);

      const payload = {
        type:'frame',  // ← 통일
        t:'frame',     // ← 호환
        image: base64,
        timestamp: Date.now(),
        location: userLocation,
        enable_special: true,
      };
      const ok = wsSendSafe(wsRef.current, payload);
      if (!ok) {
        // 전송 레이스일 수 있으니 살짝 뒤 재시도(옵션)
        setTimeout(() => wsSendSafe(wsRef.current, payload), 120);
      }
      setSentCount(c=>c+1);
      setLastFrameAt(Date.now());

      FileSystem.deleteAsync(uri, { idempotent:true }).catch(()=>{});
    }catch(e){
      console.error('📸 프레임 캡처/전송 오류:', e);
    }finally{
      busyRef.current = false;
    }
  }, [isActive, cameraReady, userLocation, isPrimary, isDetecting, wsSendSafe]);

  // ===== Start/Stop =====
  const startDetection = useCallback(()=>{
    if (!isActive() || !isPrimary) return;
    if (hasPermission !== true) return;

    setIsDetecting(true);
    connectWebSocket();

    if (!minimal){
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Speech.speak('장애물 감지를 시작합니다.', SPEECH_OPTS);
    }
  }, [isActive, isPrimary, hasPermission, connectWebSocket, minimal]);

  const stopDetection = useCallback(()=>{
    setIsDetecting(false);
    if (frameIntervalRef.current){ clearInterval(frameIntervalRef.current); frameIntervalRef.current = null; }
    disconnectWebSocket();

    setDangerLevel('safe'); setLastWarning('');
    setTlState(null); setTlRemain(null);
    setSentCount(0); setRecvCount(0); setLastFrameAt(null); setLastB64(0);
    setObstacles([]); setSpecials({ crosswalk:false, stairsUp:false, stairsDown:false });

    if (!minimal){
      Speech.speak('장애물 감지를 중지합니다.', SPEECH_OPTS);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [disconnectWebSocket, minimal]);

  // ===== Auto control by nav state =====
  useEffect(()=>{
    if (!isPrimary) return;
    if (hasPermission == null) return;
    if (hasPermission === true && (isNavigating || autoStart) && !isDetecting) {
      startDetection();
    } else if ((!isNavigating && !autoStart) && isDetecting) {
      stopDetection();
    }
  }, [isNavigating, autoStart, hasPermission, device, cameraReady, isDetecting, startDetection, stopDetection, isPrimary]);

  // ws 열렸고 autoStart인데 감지가 꺼져있으면 ON
  useEffect(() => {
    if (isPrimary && isConnected && autoStart && !isDetecting) setIsDetecting(true);
  }, [isPrimary, isConnected, autoStart, isDetecting]);

  // isDetecting false 시 프레임 루프 정리
  useEffect(() => {
    if (!isDetecting && frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
  }, [isDetecting]);

  // 연결/카메라 준비 후 프레임 루프 시작 (여기서만 생성)
  useEffect(() => {
    if (isPrimary && isDetecting && isConnected && cameraReady && !frameIntervalRef.current) {
      frameIntervalRef.current = setInterval(captureAndSendFrame, FRAME_INTERVAL);
    }
  }, [isPrimary, isDetecting, isConnected, cameraReady, captureAndSendFrame]);

  // 🔹 5초 주기: 닫혀있으면 강제 재연결
  useEffect(() => {
    const id = setInterval(() => {
      if (!isPrimary || !isDetecting) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        console.log('[ws] periodic checker -> reopen');
        connectWebSocket();
      }
    }, 5000);
    return () => clearInterval(id);
  }, [isPrimary, isDetecting, connectWebSocket]);

  // ===== Cleanup =====
  useEffect(()=>()=>{ 
    if (frameIntervalRef.current){ clearInterval(frameIntervalRef.current); frameIntervalRef.current=null; }
    disconnectWebSocket(); Speech.stop(); Vibration.cancel();
  }, [disconnectWebSocket]);

  // ===== UI =====
  if (!isPrimary) return null;

  if (hasPermission !== true){
    return (
      <View style={styles.fill}>
        <View style={styles.center}>
          <Text style={styles.errorText}>카메라 권한이 필요합니다.</Text>
          <TouchableOpacity onPress={requestPermission} style={styles.permBtn}>
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
        onInitialized={()=>{ setCameraReady(true); }}
        onError={(e)=>console.warn('📷 VisionCamera error:', e)}
      />

      {!minimal && (
        <View style={[styles.panel, { borderColor: colorByLevel(dangerLevel) }]}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>장애물 감지 {isDetecting ? '작동 중' : '대기'}</Text>
            {isConnected && <View style={styles.connectedDot} />}
          </View>

          {connectionError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {connectionError}</Text>
              <Text style={styles.errorHint}>
                서버 실행: python server.py{'\n'}
                ngrok 실행: ngrok http 8000
              </Text>
            </View>
          )}

          <Text style={styles.subtle}>URL: {wsUrlRef.current?.replace(/^wss?:\/\//,'').substring(0, 30)}...</Text>
          <Text style={styles.subtle}>sent: {sentCount}  recv: {recvCount}  lastB64: {lastB64}</Text>
          {lastFrameAt && <Text style={styles.subtle}>last frame: {new Date(lastFrameAt).toLocaleTimeString()}</Text>}

          <View style={[styles.dangerBox, { backgroundColor: colorByLevel(dangerLevel)+'30' }]}>
            <Text style={[styles.dangerText, { color: colorByLevel(dangerLevel) }]}>
              위험도: {dangerLevel === 'critical' ? '긴급' : dangerLevel === 'high' ? '높음' : dangerLevel === 'medium' ? '중간' : dangerLevel === 'low' ? '낮음' : '안전'}
            </Text>
            {tlState !== null && (
              <>
                <Text style={styles.trafficText}>신호등 상태: {TL_LABEL[tlState] ?? tlState}</Text>
                {typeof tlRemain === 'number' && <Text style={styles.trafficText}>남은 시간: {tlRemain}초</Text>}
              </>
            )}
            {lastWarning ? <Text style={styles.lastText}>마지막 안내: {lastWarning}</Text> : null}
          </View>

          {Array.isArray(obstacles) && obstacles.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={{ color:'#fff', fontWeight:'bold', marginBottom:4 }}>감지된 장애물: {obstacles.length}개</Text>
              {obstacles.slice(0,3).map((o, i) => {
                const name = o?.korean_name ?? o?.name ?? '장애물';
                const pos  = typeof o?.position === 'string' ? o.position : (o?.position?.label ?? '');
                const dist = (typeof o?.distance === 'number') ? `${Math.round(o.distance)}m` : '';
                return (
                  <Text key={i} style={{ color:'#DDD', fontSize:11 }}>
                    • {pos ? `${pos}: ` : ''}{name}{dist ? ` (${dist})` : ''}
                  </Text>
                );
              })}
            </View>
          )}

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: isDetecting ? '#FF4444' : '#44BB44' }]}
            onPress={isDetecting ? stopDetection : startDetection}
          >
            <Text style={styles.btnText}>{isDetecting ? '감지 중지' : '감지 시작'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* minimal=true 여도 항상 보이는 미니 HUD */}
      <View style={styles.tinyHud}>
        <Text style={styles.tinyHudText}>
          {isConnected ? '✅' : '❌'} s:{sentCount} r:{recvCount}
          {cameraReady ? ' cam✔' : ' cam…'}
          ws:{wsRef.current?.readyState ?? -1}
        </Text>
        <View style={{ flexDirection:'row', marginTop:4, alignItems:'center' }}>
          <Text style={styles.badge}>장애물 {Math.min(obstacles?.length || 0, 99)}</Text>
          {specials.crosswalk && <Text style={styles.badge}>🚸</Text>}
          {specials.stairsUp && <Text style={styles.badge}>⬆️ 계단</Text>}
          {specials.stairsDown && <Text style={styles.badge}>⬇️ 계단</Text>}
        </View>
        {connectionError && (
          <Text style={[styles.tinyHudText, { color:'#FF6666', fontSize:9, marginTop:2 }]}>
            {connectionError}
          </Text>
        )}
      </View>
    </View>
  );
};

// ======================== Styles ========================
const styles = StyleSheet.create({
  fill: { flex:1, backgroundColor:'#000' },
  center: { flex:1, justifyContent:'center', alignItems:'center' },

  panel: {
    position:'absolute', top:10, left:10, right:10,
    backgroundColor:'rgba(0,0,0,0.6)', borderRadius:10, borderWidth:2, padding:10,
  },
  panelHeader: { flexDirection:'row', alignItems:'center', marginBottom:6 },
  panelTitle: { color:'#fff', fontSize:15, fontWeight:'bold', flex:1 },
  connectedDot: { width:10, height:10, borderRadius:5, backgroundColor:'#00FF00' },

  subtle: { color:'#9cf', fontSize:11, marginBottom:2 },

  dangerBox: { borderRadius:6, padding:8, marginTop:6, alignItems:'flex-start' },
  dangerText: { fontSize:13, fontWeight:'bold' },
  trafficText: { color:'#fff', marginTop:3, fontSize:12 },
  lastText: { color:'#eee', marginTop:2, fontSize:11 },

  btn: { borderRadius:18, paddingVertical:8, alignItems:'center', marginTop:8 },
  btnText: { color:'#fff', fontSize:13, fontWeight:'bold' },

  errorText: { color:'#FF6666', fontSize:13, marginVertical:4 },
  errorBox: { backgroundColor:'rgba(255,100,100,0.2)', padding:8, borderRadius:4, marginVertical:4 },
  errorHint: { color:'#FFB366', fontSize:10, marginTop:4, fontFamily: 'monospace' },
  
  permBtn: { marginTop:10, padding:10, backgroundColor:'#007AFF', borderRadius:8 },
  mono: { color:'#fff', marginTop:8, textAlign:'center' },

  tinyHud: {
    position:'absolute', right:8, bottom:8,
    paddingHorizontal:8, paddingVertical:4, borderRadius:10,
    backgroundColor:'rgba(0,0,0,0.7)',
    maxWidth: 200,
  },
  tinyHudText: { color:'#9cf', fontSize:10 },
  badge: {
    color:'#fff', fontSize:10, paddingHorizontal:6, paddingVertical:2,
    marginRight:4, borderRadius:8, backgroundColor:'rgba(255,255,255,0.1)',
  }
});

export default ObstacleDetection;
