// ObstacleDetection.js
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Vibration } from 'react-native';
import { Camera, useCameraDevices, useCameraPermission } from 'react-native-vision-camera';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';

// ======================== Config ========================
// 외부 주입 가능 (prop, global, env 순서); ngrok URL 바뀔 때 앱 재빌드 없이 교체 가능
const DEFAULT_WS_URL = 'wss://7971e24307c1.ngrok-free.app/ws';
const getWsUrl = (propUrl) =>
  propUrl ||
  globalThis.__OD_WS_URL__ ||
  DEFAULT_WS_URL;

const FRAME_INTERVAL = 800; // ~3fps
const SPEECH_OPTS = { language: 'ko-KR' };

const SAFE_CROSS_SEC = 8;
const CAUTION_SEC = 5;
const FORBID_SEC = 5;

// ======================== Traffic Light ========================
const TL = { DETECTING_1:-2, DETECTING_2:-1, NONE:0, GREEN_INIT:1, RED:2, GREEN_GO:3, YELLOW:4, GREEN_BLINK:5 };
const TL_LABEL = {
  [-2]:'신호등 검출 진행 중', [-1]:'신호등 검출 진행 중', [0]:'신호등 없음', [1]:'초록불 감지(대기)',
  [2]:'빨간불(대기)', [3]:'초록불(건너도 됨)', [4]:'노란불(정지)', [5]:'초록불 점멸(대기)',
};
const TL_COOLDOWN_MS = 2500;

// ======================== Helpers ========================
function normalizeTrafficLightState(data){
  if (typeof data?.traffic_light_state === 'number') return data.traffic_light_state;
  const f = Array.isArray(data?.special_features) ? data.special_features.find(x=>x?.type==='traffic_light') : null;
  if (!f) return null;
  if (typeof f.state === 'number') return f.state;
  const s = String(f.state ?? '').toLowerCase();
  if (s === 'red') return TL.RED;
  if (s === 'yellow' || s === 'amber') return TL.YELLOW;
  if (s.includes('blink') || s.includes('flash')) return TL.GREEN_BLINK;
  if (s === 'green_go' || s === 'green' || s === 'go') return TL.GREEN_GO;
  if (s === 'green_init' || s === 'init_green' || s === 'pending') return TL.GREEN_INIT;
  if (s === 'none') return TL.NONE;
  if (s === 'detecting' || s === '') return TL.DETECTING_1;
  return null;
}
function extractRemainingSeconds(data){
  const keys = ['traffic_light_remaining','remaining_time','remain_time','remaining','time_remaining','time_left','sec_left'];
  for (const k of keys){ const v = data?.[k]; const n = normSec(v); if (n!=null) return n; }
  const f = Array.isArray(data?.special_features) ? data.special_features.find(x=>x?.type==='traffic_light') : null;
  if (f){
    for (const k of ['remaining_seconds','remaining','remainSec','time_left','sec','ms','milliseconds']){
      const v = f?.[k]; const n = normSec(v); if (n!=null) return n;
    }
  }
  return null;
}
function normSec(v){
  if (typeof v === 'string'){
    const n = parseFloat(v); if (Number.isFinite(n)) return v.toLowerCase().includes('ms') ? Math.round(n/1000) : Math.round(n);
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

// ======================== Component ========================
const ObstacleDetection = ({ isNavigating, userLocation, minimal = true, autoStart = true, wsUrl: propWsUrl }) => {
  // 단일 인스턴스만 활성
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

  // Active guard
  const instanceId = useRef(Math.random().toString(36).slice(2));
  const isActive = useCallback(() => globalThis.__OD_ACTIVE__?.id === instanceId.current, []);
   useEffect(() => {
       // ⛔ primary가 아니면 active를 가로채지 않도록 즉시 반환
       if (!isPrimary) return;

    const prev = globalThis.__OD_ACTIVE__;
    if (prev?.cleanup) { try { prev.cleanup(); } catch {} }
    const cleanup = () => {
      try { frameIntervalRef.current && clearInterval(frameIntervalRef.current); } catch {}
      frameIntervalRef.current = null;
      try { keepAliveRef.current && clearInterval(keepAliveRef.current); } catch {}
      keepAliveRef.current = null;
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
      Speech.stop(); Vibration.cancel();
    };
    globalThis.__OD_ACTIVE__ = { id: instanceId.current, cleanup };
    console.log('[OD] became active:', instanceId.current);
    return () => {
      if (globalThis.__OD_ACTIVE__?.id === instanceId.current) delete globalThis.__OD_ACTIVE__;
      cleanup();
    };
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

  // 장애물/특수 피처
  const [obstacles, setObstacles] = useState([]);
  const [specials, setSpecials] = useState({ crosswalk:false, stairsUp:false, stairsDown:false });

  // Refs
  const wsRef = useRef(null);
  const wsUrlRef = useRef(getWsUrl(propWsUrl));
  const frameIntervalRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const keepAliveRef = useRef(null);
  const busyRef = useRef(false);
  const lastWarningTimeRef = useRef(0);
  const lastTLStateRef = useRef(null);
  const lastTLAtRef = useRef(0);
  const reconnectAttemptRef = useRef(0);

  // ===== TL 안내 =====
  const announceTrafficLight = useCallback((state, remainSec) => {
    const now = Date.now();
    if (lastTLStateRef.current === state && (now - lastTLAtRef.current) < TL_COOLDOWN_MS) return;
    lastTLStateRef.current = state; lastTLAtRef.current = now;

    if (state === TL.RED){
      Speech.speak('빨간불입니다. 건너지 마세요.', SPEECH_OPTS);
      Vibration.vibrate([0,400,150,400]); return;
    }
    if (state === TL.YELLOW || state === TL.GREEN_BLINK){
      Speech.speak('신호가 곧 바뀝니다. 진입하지 말고 다음 신호를 기다리세요.', SPEECH_OPTS);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Vibration.vibrate([0,300,120,300]); return;
    }
    if (state === TL.GREEN_INIT){
      Speech.speak('초록불이 감지되었지만, 잠시만 기다려 주세요.', SPEECH_OPTS);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); return;
    }
    if (state === TL.GREEN_GO){
      if (typeof remainSec === 'number'){
        if (remainSec <= FORBID_SEC){
          Speech.speak('초록불이지만 시간이 거의 없습니다. 진입하지 말고 다음 신호를 기다리세요.', { ...SPEECH_OPTS, rate:1.05 });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); return;
        }
        if (remainSec < SAFE_CROSS_SEC && remainSec >= CAUTION_SEC){
          Speech.speak(`남은 시간 약 ${remainSec}초, 서둘러 건너세요.`, { ...SPEECH_OPTS, rate:1.05 });
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); return;
        }
      }
      Speech.speak('초록불입니다. 지금 건너세요.', { ...SPEECH_OPTS, rate:1.05, pitch:1.02 });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); return;
    }
    if (state === TL.DETECTING_1 || state === TL.DETECTING_2){
      Speech.speak('신호등을 인식 중입니다.', SPEECH_OPTS);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  // ===== Detection result =====
  const handleDetectionResult = useCallback((data) => {
    if (data?.error){ console.error('🧪 감지 오류:', data.error); return; }

    setDangerLevel(data?.danger_level || 'safe');

    // 장애물 목록
    const obs = Array.isArray(data?.obstacles) ? data.obstacles : [];
    setObstacles(obs);

    // 신호등
    const s = normalizeTrafficLightState(data);
    const r = extractRemainingSeconds(data);
    if (s !== null && s !== undefined){
      setTlState(s); setTlRemain(typeof r === 'number' ? r : null);
      announceTrafficLight(s, typeof r === 'number' ? r : null);
    }

    // 특수 피처
    const feats = Array.isArray(data?.special_features) ? data.special_features : [];
    const flags = {
      crosswalk: !!feats.find(f => f?.type === 'crosswalk'),
      stairsUp:  !!feats.find(f => f?.type === 'stairs_up'),
      stairsDown:!!feats.find(f => f?.type === 'stairs_down'),
    };
    setSpecials(flags);

    // 햅틱/진동
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

    if (flags.stairsUp) {
      try { Speech.speak('오르막 계단이 있습니다.', SPEECH_OPTS); } catch {}
      Vibration.vibrate([0, 200, 100, 200]);
    }
    if (flags.stairsDown) {
      try { Speech.speak('내리막 계단이 있습니다. 주의하세요.', SPEECH_OPTS); } catch {}
      Vibration.vibrate([0, 300, 100, 300]);
    }
    if (flags.crosswalk) {
      try { Speech.speak('횡단보도입니다.', SPEECH_OPTS); } catch {}
    }

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
    const delay = Math.min(30000, 1000 * Math.pow(2, attempt)); // 1s,2s,4s,...cap 30s
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

  const startKeepAlive = useCallback(() => {
    if (keepAliveRef.current) return;
    keepAliveRef.current = setInterval(() => {
      try {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ t:'ping', ts: Date.now() }));
        }
      } catch {}
    }, 20000); // 20s ping
  }, []);

  const stopKeepAlive = useCallback(() => {
    if (keepAliveRef.current){ clearInterval(keepAliveRef.current); keepAliveRef.current = null; }
  }, []);

  const connectWebSocket = useCallback(() => {
    if (!isActive() || !isPrimary || !isDetecting) return;
    try{
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      const url = wsUrlRef.current = getWsUrl(propWsUrl);
      console.log('🔌 WebSocket 연결 시도:', url);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('🟢 WebSocket 연결 성공');
        setIsConnected(true); setConnectionError(null);
        reconnectAttemptRef.current = 0;
        clearReconnectTimer();
        startKeepAlive();
        if (!minimal){
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Speech.speak('장애물 감지 서버 연결됨', SPEECH_OPTS);
        }
      };
      ws.onmessage = (event) => {
        try{
          const data = JSON.parse(event.data);
          if (data?.t === 'pong') return;
          setRecvCount(c=>c+1);
          handleDetectionResult(data);
        }catch(e){ console.error('📨 메시지 파싱 오류:', e); }
      };
      ws.onerror = (e) => {
        const msg = e?.message || String(e);
        console.error('🔴 WebSocket 오류:', msg);
        // 101 대신 404가 왔을 가능성 → URL/경로가 틀렸거나 ngrok URL이 바뀐 경우
        if (/101|404|Not Found/i.test(msg)) {
          setConnectionError('서버 업그레이드 실패(경로/URL 확인 필요)');
        } else {
          setConnectionError('서버 연결 오류');
        }
      };
      ws.onclose = (ev) => {
        console.log('⚪ WebSocket 연결 종료', ev?.code, ev?.reason);
        setIsConnected(false);
        stopKeepAlive();
        scheduleReconnect();
      };
    }catch(e){
      console.error('🔴 WebSocket 생성 오류:', e);
      setConnectionError('연결 생성 실패');
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
      // 캡처 전 빠른 가드
      if (!isActive() || !isPrimary) return;
      if (!isDetecting) return;
      if (!cameraReady || !cameraRef.current) { console.log('[capture] camera not ready'); return; }
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) { console.log('[capture] ws not open'); return; }
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
      if (!base64) { console.log('[capture] empty base64'); return; }

      setLastB64(base64?.length || 0);

      wsRef.current.send(JSON.stringify({
        t:'frame',
        image: base64,
        timestamp: Date.now(),
        location: userLocation,
        enable_special: true,
      }));
      setSentCount(c=>c+1);
      setLastFrameAt(Date.now());

      FileSystem.deleteAsync(uri, { idempotent:true }).catch(e=>console.log('[capture] delete fail', e));
    }catch(e){
      console.error('📸 프레임 캡처/전송 오류:', e);
    }finally{
      busyRef.current = false;
    }
  }, [isActive, cameraReady, userLocation, isPrimary, isDetecting]);

  // ===== Start/Stop =====
  const startDetection = useCallback(()=>{
    if (!isActive() || !isPrimary) return;
    if (hasPermission !== true || !device) return;

    setIsDetecting(true);
    connectWebSocket();
    if (!frameIntervalRef.current){
      // 카메라 초기화 시간을 조금 주고 시작
      frameIntervalRef.current = setInterval(captureAndSendFrame, FRAME_INTERVAL);
    }
    if (!minimal){
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Speech.speak('장애물 감지를 시작합니다.', SPEECH_OPTS);
    }
  }, [isActive, isPrimary, hasPermission, device, connectWebSocket, captureAndSendFrame, minimal]);

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
      console.log('[auto] startDetection by', isNavigating ? 'navigation' : 'autoStart');
      startDetection();
    } else if ((!isNavigating && !autoStart) && isDetecting) {
      console.log('[auto] stopDetection by navigation end');
      stopDetection();
    }
  }, [isNavigating, autoStart, hasPermission, isDetecting, startDetection, stopDetection, isPrimary]);

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
        isActive={true}     // 프리뷰는 항상 표시
        photo={true}        // takePhoto 사용
        video={false}
        enableZoomGesture={false}
        onInitialized={()=>{ console.log('✅ [VisionCamera] initialized'); setCameraReady(true); }}
        onError={(e)=>console.warn('📷 VisionCamera error:', e)}
      />

      {/* 디버그 패널 (minimal=false일 때만 상세 정보 표시) */}
      {!minimal && (
        <View style={[styles.panel, { borderColor: colorByLevel(dangerLevel) }]}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>장애물 감지 {isDetecting ? '작동 중' : '대기'}</Text>
            {isConnected && <View style={styles.connectedDot} />}
          </View>
          {connectionError && <Text style={styles.errorText}>{connectionError}</Text>}
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

          {/* 장애물 TOP3 리스트 */}
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

          {/* 수동 시작/중지 버튼 */}
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
          {isConnected ? '●' : '○'} s:{sentCount} r:{recvCount}
          {cameraReady ? ' cam✔' : ' cam…'}
          ws:{wsRef.current?.readyState ?? -1}
        </Text>
        <View style={{ flexDirection:'row', marginTop:4, alignItems:'center' }}>
          <Text style={styles.badge}>장애물 {Math.min(obstacles?.length || 0, 99)}</Text>
          {specials.crosswalk && <Text style={styles.badge}>🚸</Text>}
          {specials.stairsUp && <Text style={styles.badge}>⬆️ 계단</Text>}
          {specials.stairsDown && <Text style={styles.badge}>⬇️ 계단</Text>}
        </View>
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
  permBtn: { marginTop:10, padding:10, backgroundColor:'#007AFF', borderRadius:8 },
  mono: { color:'#fff', marginTop:8, textAlign:'center' },

  tinyHud: {
    position:'absolute', right:8, bottom:8,
    paddingHorizontal:8, paddingVertical:4, borderRadius:10,
    backgroundColor:'rgba(0,0,0,0.55)'
  },
  tinyHudText: { color:'#9cf', fontSize:10 },
  badge: {
    color:'#fff',
    fontSize:10,
    paddingHorizontal:6,
    paddingVertical:2,
    marginRight:4,
    borderRadius:8,
    backgroundColor:'rgba(255,255,255,0.1)',
  }
});

export default ObstacleDetection;
