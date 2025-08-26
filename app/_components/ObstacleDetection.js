// app/_components/ObstacleDetection.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Vibration,
} from 'react-native';
import { Camera, CameraView } from 'expo-camera';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';

// ✅ 실제 서버 주소
const WEBSOCKET_URL = 'wss://153b9a04bc1c.ngrok-free.app/ws';

// 전송 주기(너무 짧으면 발열/트래픽↑)
const FRAME_INTERVAL = 1000; // 1s

const ObstacleDetection = ({ isNavigating, userLocation }) => {
  const [hasPermission, setHasPermission] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);

  const [isDetecting, setIsDetecting] = useState(false);
  const [obstacles, setObstacles] = useState([]);
  const [dangerLevel, setDangerLevel] = useState('safe');
  const [lastWarning, setLastWarning] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);

  const [sentCount, setSentCount] = useState(0);
  const [recvCount, setRecvCount] = useState(0);
  const [lastB64, setLastB64] = useState(0);

  const cameraRef = useRef(null);
  const wsRef = useRef(null);
  const frameIntervalRef = useRef(null);
  const lastWarningTimeRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const captureBusyRef = useRef(false);

  // ---- Permissions ----
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Camera.requestCameraPermissionsAsync();
        setHasPermission(status === 'granted');
      } catch {
        setHasPermission(false);
      }
    })();
  }, []);

  // ---- WebSocket ----
  const connectWebSocket = useCallback(() => {
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      wsRef.current = new WebSocket(WEBSOCKET_URL);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        setConnectionError(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Speech.speak('장애물 감지 서버 연결됨', { language: 'ko-KR' });
        wsRef.current?.send?.(JSON.stringify({ t: 'hello', role: 'mobile' }));
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setRecvCount((c) => c + 1);
          handleDetectionResult(data);
        } catch (e) {
          console.error('메시지 파싱 오류:', e);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket 오류:', error?.message || error);
        setConnectionError('서버 연결 오류');
        setIsConnected(false);
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        if (isDetecting && !reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connectWebSocket();
          }, 5000);
        }
      };
    } catch (e) {
      console.error('WebSocket 생성 오류:', e);
      setConnectionError('연결 생성 실패');
    }
  }, [isDetecting]);

  const disconnectWebSocket = useCallback(() => {
    try {
      wsRef.current?.close?.();
    } catch {}
    wsRef.current = null;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // ---- Utils ----
  const speakOnce = useCallback((msg, minGapMs = 2500, opts = {}) => {
    const now = Date.now();
    if (now - lastWarningTimeRef.current < minGapMs) return;
    try { Speech.stop(); } catch {}
    Speech.speak(msg, { language: 'ko-KR', rate: 1.05, ...opts });
    lastWarningTimeRef.current = now;
    setLastWarning(msg);
  }, []);

  const normalizeObstacles = (list) => {
    if (!Array.isArray(list)) return [];
    return list
      .map((o, i) => {
        const lat =
          o?.latitude ??
          o?.lat ??
          o?.position?.latitude ??
          o?.position?.lat ??
          o?.coord?.lat;
        const lng =
          o?.longitude ??
          o?.lng ??
          o?.position?.longitude ??
          o?.position?.lng ??
          o?.coord?.lng;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          id: o?.id ?? `ob-${i}`,
          korean_name: o?.korean_name ?? o?.name ?? '장애물',
          distance: Number.isFinite(o?.distance) ? o.distance : undefined,
          positionLabel:
            typeof o?.position === 'string'
              ? o.position
              : o?.korean_direction || o?.direction || '',
          lat,
          lng,
          raw: o,
        };
      })
      .filter(Boolean);
  };

  // ---- Handle detection payload ----
  const handleDetectionResult = useCallback(
    (data) => {
      if (!data || typeof data !== 'object') return;

      // list & level
      setObstacles(normalizeObstacles(data.obstacles || []));
      setDangerLevel(data.danger_level || 'safe');

      // ===== special features (신호등/계단/횡단보도 등) =====
      if (Array.isArray(data.special_features) && data.special_features.length) {
        for (const feature of data.special_features) {
          if (!feature || typeof feature !== 'object') continue;

          // 신호등
          if (feature.type === 'traffic_light') {
            if (feature.state === 'red') {
              speakOnce('빨간불입니다. 정지하세요.', 2000, { pitch: 1.1 });
              Vibration.vibrate([0, 500, 200, 500]);
            } else if (feature.state === 'green') {
              speakOnce('초록 신호등입니다.', 2000);
            } else if (feature.state === 'yellow') {
              speakOnce('노란 신호등입니다. 주의하세요.', 2000);
            }
          }

          // 계단
          else if (feature.type === 'stairs_up') {
            speakOnce('오르막 계단이 있습니다.', 2000);
            Vibration.vibrate([0, 200, 100, 200]);
          } else if (feature.type === 'stairs_down') {
            speakOnce('내리막 계단이 있습니다. 주의하세요.', 2000);
            Vibration.vibrate([0, 300, 100, 300]);
          }

          // ✅ 횡단보도(거리/방향 포함)
          else if (feature.type === 'crosswalk') {
            const dir =
              feature.korean_direction ||
              feature.direction ||
              '앞에';
            const hasDist = Number.isFinite(feature.distance);
            const dist = hasDist ? `${Math.max(1, Math.round(feature.distance))}미터 ` : '';
            const msg = `${dir} ${dist}횡단보도가 있습니다. 주의하세요.`;
            speakOnce(msg, 2500);
            Vibration.vibrate([0, 150, 100, 150]);
          }
        }
      }

      // ===== danger haptics =====
      if (data.danger_level === 'critical') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Vibration.vibrate([0, 300, 100, 300, 100, 300]);
      } else if (data.danger_level === 'high') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Vibration.vibrate([0, 200, 100, 200, 100, 200]);
      } else if (data.danger_level === 'medium') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Vibration.vibrate([0, 150, 100, 150]);
      } else if (Array.isArray(data.obstacles) && data.obstacles.length > 0) {
        Vibration.vibrate(100);
      }

      // ===== priority_warning (서버 멘트 우선) =====
      if (data.priority_warning) {
        speakOnce(data.priority_warning, 2000, {
          rate: 1.15,
          pitch: data.danger_level === 'critical' ? 1.15 : 1.0,
        });
      }

      // 디버그
      if (data.closest_obstacle) {
        console.log(
          `가장 가까운 장애물: ${data.closest_obstacle.korean_name} (${data.closest_obstacle.distance}m)`
        );
      }
    },
    [speakOnce]
  );

  // ---- Capture & send ----
  const captureAndSendFrame = useCallback(async () => {
    if (!cameraRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!cameraReady || captureBusyRef.current) return;

    captureBusyRef.current = true;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.25,
        base64: true,
        skipProcessing: true,
      });

      const b64len = photo?.base64?.length ?? 0;
      setLastB64(b64len);

      const frameData = {
        t: 'frame',
        image: photo.base64,
        timestamp: Date.now(),
        location: userLocation,
        enable_special: true,
      };

      wsRef.current.send(JSON.stringify(frameData));
      setSentCount((c) => c + 1);
    } catch (e) {
      console.error('프레임 캡처 오류:', e);
    } finally {
      captureBusyRef.current = false;
    }
  }, [cameraReady, userLocation]);

  // ---- Start/Stop detection ----
  const startDetection = useCallback(() => {
    if (isDetecting) return;
    setIsDetecting(true);
    connectWebSocket();
    frameIntervalRef.current = setInterval(captureAndSendFrame, FRAME_INTERVAL);
    Speech.speak('장애물 감지를 시작합니다.', { language: 'ko-KR' });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [connectWebSocket, captureAndSendFrame, isDetecting]);

  const stopDetection = useCallback(() => {
    if (!isDetecting) return;
    setIsDetecting(false);
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    disconnectWebSocket();
    setObstacles([]);
    setDangerLevel('safe');
    setLastWarning('');
    Speech.speak('장애물 감지를 중지합니다.', { language: 'ko-KR' });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [disconnectWebSocket, isDetecting]);

  // ---- Auto start/stop by nav state ----
  useEffect(() => {
    if (isNavigating && !isDetecting) startDetection();
    else if (!isNavigating && isDetecting) stopDetection();
  }, [isNavigating, isDetecting, startDetection, stopDetection]);

  // ---- Cleanup ----
  useEffect(() => {
    return () => {
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      disconnectWebSocket();
      try { Speech.stop(); } catch {}
      Vibration.cancel();
    };
  }, [disconnectWebSocket]);

  // ---- UI ----
  if (hasPermission === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text>카메라 권한 확인 중...</Text>
      </View>
    );
  }
  if (hasPermission === false) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>카메라 권한이 필요합니다.</Text>
      </View>
    );
  }

  const getBorderColor = () => {
    switch (dangerLevel) {
      case 'critical': return '#FF0000';
      case 'high': return '#FF6600';
      case 'medium': return '#FFAA00';
      case 'low': return '#00AA00';
      default: return '#00FF00';
    }
  };

  return (
    <View style={styles.container}>
      {/* 카메라 미니뷰 */}
      <View style={[styles.cameraContainer, { opacity: 0.3 }]}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          ratio="16:9"
          onCameraReady={() => {
            setCameraReady(true);
            console.log('[Camera] ready');
          }}
        />
      </View>

      {/* 상태 표시 */}
      <View style={[styles.statusContainer, { borderColor: getBorderColor(), borderWidth: 3 }]}>
        <View style={styles.statusHeader}>
          <Text style={styles.statusTitle}>
            장애물 감지 {isDetecting ? '작동 중' : '대기'}
          </Text>
          {isConnected && <View style={styles.connectedIndicator} />}
        </View>

        {connectionError && <Text style={styles.errorText}>{connectionError}</Text>}

        {/* 디버그 카운터 */}
        <Text style={styles.debugText}>sent:{sentCount} recv:{recvCount} b64:{lastB64}</Text>

        {isDetecting && obstacles.length > 0 && (
          <View style={styles.obstacleList}>
            <Text style={styles.obstacleCount}>
              감지된 장애물: {obstacles.length}개
            </Text>
            {obstacles.slice(0, 3).map((o, idx) => {
              const name = o?.korean_name ?? '장애물';
              const pos = o?.positionLabel ? `${o.positionLabel}: ` : '';
              const dist = Number.isFinite(o?.distance) ? ` (${Math.round(o.distance)}m)` : '';
              return (
                <Text key={o.id ?? idx} style={styles.obstacleItem}>
                  • {pos}{name}{dist}
                </Text>
              );
            })}
          </View>
        )}

        {isDetecting && (
          <View style={[styles.dangerIndicator, { backgroundColor: getBorderColor() + '30' }]}>
            <Text style={[styles.dangerText, { color: getBorderColor() }]}>
              위험도:{' '}
              {dangerLevel === 'critical' ? '긴급' :
               dangerLevel === 'high' ? '높음' :
               dangerLevel === 'medium' ? '중간' :
               dangerLevel === 'low' ? '낮음' : '안전'}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.controlButton, { backgroundColor: isDetecting ? '#FF4444' : '#44FF44' }]}
          onPress={isDetecting ? stopDetection : startDetection}
        >
          <Text style={styles.buttonText}>
            {isDetecting ? '감지 중지' : '감지 시작'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ---- Styles ----
const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 100,
    left: 10,
    right: 10,
    zIndex: 100,
  },
  cameraContainer: {
    width: 100,
    height: 75,
    position: 'absolute',
    top: 0,
    right: 0,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#333',
  },
  camera: { flex: 1 },
  statusContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 10,
    padding: 15,
  },
  statusHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  statusTitle: { color: 'white', fontSize: 16, fontWeight: 'bold', flex: 1 },
  connectedIndicator: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#00FF00' },
  errorText: { color: '#FF4444', fontSize: 14, marginVertical: 5 },
  debugText: { color: '#9cf', fontSize: 12, marginBottom: 6 },

  obstacleList: { marginVertical: 10 },
  obstacleCount: { color: 'white', fontSize: 14, fontWeight: 'bold', marginBottom: 5 },
  obstacleItem: { color: '#CCC', fontSize: 12, marginLeft: 10, marginVertical: 2 },

  dangerIndicator: { borderRadius: 5, padding: 8, marginVertical: 5, alignItems: 'center' },
  dangerText: { fontSize: 14, fontWeight: 'bold' },

  controlButton: { borderRadius: 20, padding: 10, alignItems: 'center', marginTop: 10 },
  buttonText: { color: 'white', fontSize: 14, fontWeight: 'bold' },
});

export default ObstacleDetection;
