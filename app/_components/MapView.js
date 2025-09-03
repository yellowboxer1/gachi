import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  NaverMapView,
  NaverMapPathOverlay,
  NaverMapMarkerOverlay,
} from '@mj-studio/react-native-naver-map';
import {
  StyleSheet,
  View,
  Text,
  PanResponder,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  Pressable,
  Animated,
} from 'react-native';
import ObstacleDetection from './ObstacleDetection';
import ARDirectionalArrow from './ARDirectionalArrow'; // ✅ 새 화살표 오버레이
import { getPoiCoordinates } from '../../services/naverService';
import { calculateDistance } from '../../utils/locationUtils';
import tts from './ttsService';
// import { dir4FromAngle } from '../dirUtils'; // (사용 안 하면 주석)

const MapView = ({
  userLocation,
  destination,
  route,
  instructions = [],
  startListening,
  stopListening,
  startNavigation,
  stopNavigation,
  searchDestination,
  isNavigationMode,
  setIsNavigationMode,
  recognizedText,
  remainingDistance = 0,
  estimatedTime = 0,
  currentDirection = '',
  isOffRoute = false,
  routeSummary = null,
}) => {
  // ====== State ======
  const [isGestureMode, setIsGestureMode] = useState(false);
  const [isConfirmMode, setIsConfirmMode] = useState(false);
  const [recognizedDestination, setRecognizedDestination] = useState(null);
  const [recognizedPoiList, setRecognizedPoiList] = useState([]);
  const [currentPoiIndex, setCurrentPoiIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [mapError, setMapError] = useState(null);

  // 테스트 입력
  const [testInputVisible, setTestInputVisible] = useState(false);
  const [testDestination, setTestDestination] = useState('');

  // 안전 상태
  const [safeWalkRoute, setSafeWalkRoute] = useState([]);
  const [safeSubwayRoute, setSafeSubwayRoute] = useState([]);
  const [safeBusRoute, setSafeBusRoute] = useState([]);
  const [safeDestination, setSafeDestination] = useState(null);
  const [safeUserLocation, setSafeUserLocation] = useState(null);
  const [safeInstructions, setSafeInstructions] = useState([]);

  const [unifiedTransitPath, setUnifiedTransitPath] = useState([]);
  const [showDetectDebug, setShowDetectDebug] = useState(false);

  // ✅ 기기 헤딩(선택)
  const [deviceHeadingDeg, setDeviceHeadingDeg] = useState(null);

  // ====== Refs ======
  const mapRef = useRef(null);
  const miniMapRef = useRef(null);                // ✅ 미니맵
  const lastMiniCamAtRef = useRef(0);             // ✅ 쓰로틀
  const longPressTimeoutRef = useRef(null);
  const confirmTimeoutRef = useRef(null);
  const didFitOnceRef = useRef(false);
  const followCamTimer = useRef(null);
  const navInFlightRef = useRef(false);

  // 🔑 음성인식 반복 방지
  const lastQueryRef = useRef('');
  const lastQueryAtRef = useRef(0);

  // ====== Layout animation (일반 ↔ 내비) ======
  const topFlex = useRef(new Animated.Value(isNavigationMode ? 0.0 : 1)).current;
  const bottomFlex = useRef(new Animated.Value(isNavigationMode ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(topFlex, {
      toValue: isNavigationMode ? 0.0 : 1,
      duration: 260,
      useNativeDriver: false,
    }).start();
    Animated.timing(bottomFlex, {
      toValue: isNavigationMode ? 1 : 0,
      duration: 260,
      useNativeDriver: false,
    }).start();
  }, [isNavigationMode, topFlex, bottomFlex]);

  // ====== Gesture ======
  const lastTapRef = useRef(0);
  const handleDoubleTapOrSingle = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 350) {
      tts.speak('경로 안내를 취소합니다.', { priority: 10, type: 'map' });
      stopNavigation?.();
      setIsNavigationMode?.(false);
    }
    lastTapRef.current = now;
  }, [setIsNavigationMode, stopNavigation]);

  const handleLongPress = useCallback(() => {
    if (isNavigationMode) return; // 내비 중엔 검색 시작 금지
    tts.speak('음성 검색을 시작합니다. 목적지를 말해주세요.', { priority: 10, type: 'ui' });
    startListening?.();
    setIsGestureMode(true);
  }, [startListening, isNavigationMode]);

  // ====== Speech util ======
  const speak = useCallback((text, opts = {}) => {
    if (!text) return;
    tts.speak(text, { priority: 10, type: 'ui', ...opts });
  }, []);

  // ====== Coord Utils ======
  const validateAndFormatCoordinate = useCallback((coord) => {
    if (!coord) return null;
    const c = Array.isArray(coord) ? coord[0] : coord;
    if (!c || !('latitude' in c) || !('longitude' in c)) return null;
    let { latitude: lat, longitude: lng } = c;
    if (typeof lat === 'string') lat = parseFloat(lat);
    if (typeof lng === 'string') lng = parseFloat(lng);
    if (isNaN(lat) || isNaN(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { latitude: +lat.toFixed(6), longitude: +lng.toFixed(6) };
  }, []);

  const dedupeSequentialCoords = useCallback((arr) => {
    const out = [];
    let prevKey = '';
    for (const c of arr) {
      const key = `${c.latitude.toFixed(6)}:${c.longitude.toFixed(6)}`;
      if (key !== prevKey) out.push(c);
      prevKey = key;
    }
    return out;
  }, []);

  const validateRouteArray = useCallback(
    (routeArray) => {
      if (!Array.isArray(routeArray)) return [];
      const validated = routeArray
        .map((coord) => validateAndFormatCoordinate(coord))
        .filter(Boolean);
      return dedupeSequentialCoords(validated);
    },
    [validateAndFormatCoordinate, dedupeSequentialCoords]
  );

  // ====== 위치 준비 대기 ======
  const waitForLocation = useCallback(async (timeoutMs = 2500) => {
    if (safeUserLocation) return true;
    const start = Date.now();
    while (!safeUserLocation && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return !!safeUserLocation;
  }, [safeUserLocation]);

  // ====== Navigation Reset ======
  const resetNavigation = useCallback(() => {
    setIsConfirmMode(false);
    setIsGestureMode(false);
    setRecognizedDestination(null);
    setRecognizedPoiList([]);
    setCurrentPoiIndex(0);
    setSafeDestination(null);
    setSafeWalkRoute([]);
    setSafeSubwayRoute([]);
    setSafeBusRoute([]);
    setSafeInstructions([]);
    setUnifiedTransitPath([]);
    didFitOnceRef.current = false;
    navInFlightRef.current = false;

    stopListening?.();
    if (confirmTimeoutRef.current) {
      clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = null;
    }
  }, [stopListening]);

  // ====== POI 제시 ======
  const presentPoi = useCallback((list, index) => {
    stopListening?.();
    setIsGestureMode(false);

    const poiList = list ?? recognizedPoiList;
    const i = typeof index === 'number' ? index : currentPoiIndex;

    if (!poiList || !poiList.length) {
      speak('검색 결과가 없습니다. 다시 검색해 주세요.');
      resetNavigation();
      return;
    }
    if (i >= poiList.length) {
      speak('더 이상 검색 결과가 없습니다.');
      resetNavigation();
      return;
    }
    const poi = poiList[i];
    const cityName = poi.upperAddrName || '';
    const locationInfo = cityName ? `${cityName}에 위치한 ` : '';
    speak(`${locationInfo}${poi.name}을 찾았습니다. 맞으면 화면을 한 번, 다른 결과를 원하시면 두 번 눌러주세요.`);

    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    const lockedName = poi.name;
    confirmTimeoutRef.current = setTimeout(() => {
      setIsConfirmMode(false);
      setIsGestureMode(false);
      stopListening?.();
      speak('시간이 초과되어 자동으로 경로를 탐색합니다.');
      handleSearchDestination(lockedName, true);
    }, 10000);
  }, [recognizedPoiList, currentPoiIndex, resetNavigation, speak, stopListening]);

  // ====== 검색 플로우 ======
  const startQueryFlow = useCallback(async (query) => {
    await waitForLocation();

    setRecognizedDestination(query);
    setIsConfirmMode(true);
    setCurrentPoiIndex(0);
    setRecognizedPoiList([]);

    try {
      setIsLoading(true);
      let poiDataList = await getPoiCoordinates(query, safeUserLocation);

      if (!Array.isArray(poiDataList) || poiDataList.length === 0) {
        const adjusted = query.replace(/\s+/g, '');
        poiDataList = await getPoiCoordinates(adjusted, safeUserLocation);
        if (!poiDataList?.length) {
          const keywords = query.split(' ');
          for (const kw of keywords) {
            if (kw.length > 1) {
              // eslint-disable-next-line no-await-Loop
              poiDataList = await getPoiCoordinates(kw, safeUserLocation);
              if (poiDataList?.length) break;
            }
          }
        }
        if (!poiDataList?.length) {
          speak('검색 결과가 없습니다. 다시 시도해주세요.');
          setIsConfirmMode(false);
          resetNavigation();
          return;
        }
      }

      const norm = (s) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, '');
      const hasSuffix = (q, kw) => new RegExp(`${kw}$`).test(q);
      const landmarkSuffixes = ['역','공원','대학교','병원','구청','시청','터미널','공항','해수욕장','시장','백화점'];
      const cityHints = ['부산','서울','인천','대구','대전','광주','울산','제주','수원','성남','용인','고양','창원'];
      const qRaw = (query || '').trim();
      const qn = norm(qRaw);

      const scorePoi = (p) => {
        const name = p?.name || '';
        const addr = `${p?.upperAddrName || ''} ${p?.middleAddrName || ''} ${p?.lowerAddrName || ''} ${p?.fullAddress || ''}`;
        const nn = norm(name);
        const an = norm(addr);
        let score = 0;

        if (nn === qn) score += 100;
        else if (nn.replace(/[^가-힣a-z0-9]/g, '') === qn.replace(/[^가-힣a-z0-9]/g, '')) score += 90;
        else if (nn.includes(qn) && qn.length >= 2) score += 60;
        else if (qn.includes(nn) && nn.length >= 2) score += 50;

        for (const suf of landmarkSuffixes) {
          if (hasSuffix(qRaw, suf) && name.includes(suf)) { score += 20; break; }
        }
        for (const c of cityHints) {
          if (qRaw.includes(c) && addr.includes(c)) { score += 15; break; }
        }

        let dist = Infinity;
        if (safeUserLocation) {
          dist = calculateDistance(
            safeUserLocation.latitude, safeUserLocation.longitude,
            p.latitude, p.longitude
          );
          const distBoost = Math.max(0, 20 - Math.min(20, dist / 100));
          score += distBoost;
        }

        return { ...p, __score: score, __dist: dist };
      };

      const enriched = poiDataList
        .map((poi) => {
          const v = validateAndFormatCoordinate(poi);
          if (!v) return null;
          return { ...poi, latitude: v.latitude, longitude: v.longitude };
        })
        .filter(Boolean)
        .map(scorePoi)
        .sort((a, b) => b.__score - a.__score || a.__dist - b.__dist);

      const top3 = enriched.slice(0, 3);
      if (!top3.length) {
        speak('유효한 검색 결과가 없습니다.');
        setIsConfirmMode(false);
        resetNavigation();
        return;
      }

      setRecognizedPoiList(top3);
      presentPoi(top3, 0);
    } catch (e) {
      speak('검색 중 오류가 발생했습니다.');
      setIsConfirmMode(false);
      resetNavigation();
    } finally {
      setIsLoading(false);
    }
  }, [presentPoi, resetNavigation, safeUserLocation, speak, validateAndFormatCoordinate, waitForLocation]);

  // ====== 확인 탭 처리 ======
  const handleConfirmTap = (tapCount) => {
    if (confirmTimeoutRef.current) { 
      clearTimeout(confirmTimeoutRef.current); 
      confirmTimeoutRef.current = null; 
    }

    if (tapCount === 1) {
      speak('경로를 탐색합니다.');
      stopListening?.();          // 🔸 확정 시 음성 인식 OFF
      const selectedPoi = recognizedPoiList[currentPoiIndex];
      if (selectedPoi) {
        const coordinates = validateAndFormatCoordinate(selectedPoi);
        if (coordinates) {
          handleSearchDestination(selectedPoi.name, true);
        }
      }
      setIsConfirmMode(false);
      setIsGestureMode(false);
    } else if (tapCount === 2) {
      if (currentPoiIndex + 1 < recognizedPoiList.length) {
        speak('다음 검색 결과를 확인합니다.');
        const nextIdx = currentPoiIndex + 1;
        setCurrentPoiIndex(nextIdx);
        presentPoi(recognizedPoiList, nextIdx);
      } else {
        speak('검색을 취소합니다.');
        resetNavigation();
      }
    }
  };

  // ====== 목적지 확정/검색 ======
  const handleSearchDestination = async (query, forceSelected = false) => {
    try {
      if (navInFlightRef.current) return false;
      setIsLoading(true);

      let coordinates = null;

      if (forceSelected && recognizedPoiList.length && currentPoiIndex < recognizedPoiList.length) {
        const sel = recognizedPoiList[currentPoiIndex];
        coordinates = validateAndFormatCoordinate(sel);
      } else {
        await waitForLocation();
        const poiDataList = await getPoiCoordinates(query, safeUserLocation);
        if (poiDataList?.length) coordinates = validateAndFormatCoordinate(poiDataList[0]);
      }

      if (coordinates) {
        speak('목적지를 찾았습니다. 경로를 탐색합니다.');
        setSafeDestination(coordinates);
        didFitOnceRef.current = false;

        // 🔑 탐색 시작 전에 음성 인식/검색모드 종료
        stopListening?.();
        setIsGestureMode(false);
        setIsConfirmMode(false);

        navInFlightRef.current = true;
        setTimeout(() => {
          if (typeof startNavigation === 'function') {
            startNavigation({ latitude: coordinates.latitude, longitude: coordinates.longitude });
            setIsNavigationMode?.(true);
          } else if (typeof searchDestination === 'function') {
            searchDestination(query, coordinates);
          }
          navInFlightRef.current = false;
        }, 400);

        return true;
      } else {
        speak('목적지를 찾을 수 없습니다.');
        return false;
      }
    } catch (e) {
      speak('검색 중 오류가 발생했습니다.');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // ====== 실시간 정보 포맷팅 ======
  const formatDistance = useCallback((meters) => {
    // 요청: Km 단위 표시
    return `${(meters / 1000).toFixed(1)}Km`;
  }, []);

  const formatTime = useCallback((minutes) => {
    return `${Math.round(minutes)}분`;
  }, []);

 // 짧은 거리 포맷 (ex: 120m, 1.3km)
 const formatDistanceShort = useCallback((meters) => {
   if (!Number.isFinite(meters) || meters < 0) return '';
   if (meters < 1000) return `${Math.round(meters)}m`;
   return `${(meters / 1000).toFixed(1)}km`;
 }, []);

 // ETA(분) 계산: routeSummary > estimatedTime(초 보정) > 거리 기반 추정
 const etaMinutes = useMemo(() => {
   // 1) routeSummary.durationSec 우선 (초 → 분)
   if (routeSummary && Number.isFinite(routeSummary.durationSec)) {
     return Math.max(0, routeSummary.durationSec / 60);
   }
   // 2) estimatedTime 보정: 초 단위로 들어온 경우 대비
   if (Number.isFinite(estimatedTime) && estimatedTime > 0) {
     // "큰 값인데 초일 가능성" 휴리스틱 (10분=600초~3시간=10800초 범위)
     if (estimatedTime >= 600 && estimatedTime <= 10800) {
       return estimatedTime / 60;
     }
     // 이미 분 단위일 수 있음
     if (estimatedTime <= 600) { // 10시간 이내라고 가정
       return estimatedTime;
     }
   }
   // 3) 폴백: 남은거리 기반 추정 (m/s)
   if (Number.isFinite(remainingDistance) && remainingDistance > 0) {
     const speedMps = (renderMode === 'transit') ? 8.3 : 1.35;
     return remainingDistance / (speedMps * 60);
   }
   return 0;
 }, [routeSummary, estimatedTime, remainingDistance, renderMode]);

// 다음 경로 안내 라벨: "{거리} {방향}" (예: "120m 직진")
 const nextStepLabel = useMemo(() => {
   if (!isNavigationMode || !safeUserLocation || !safeInstructions?.length) return '';
   // 가장 가까운 안내 지점 선택
   let best = null;
   let bestD = Infinity;
   for (const ins of safeInstructions) {
    const d = calculateDistance(
       safeUserLocation.latitude, safeUserLocation.longitude,
       ins.position.latitude, ins.position.longitude
     );
     if (d < bestD) { bestD = d; best = ins; }
   }
   if (!best || !Number.isFinite(bestD)) return '';
   // 방향 추출
   const desc = (best.description || '').toString();
   let dir = '직진';
   if (desc.includes('좌')) dir = '좌회전';
   else if (desc.includes('우')) dir = '우회전';
   else if (desc.includes('U') || desc.includes('유턴') || desc.toLowerCase().includes('uturn')) dir = 'U턴';
   return `${formatDistanceShort(bestD)} ${dir}`;
 }, [isNavigationMode, safeUserLocation, safeInstructions, formatDistanceShort]);

  // ====== 제스처(상단 50%만 적용) ======
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,
      onPanResponderGrant: () => {
        longPressTimeoutRef.current = setTimeout(() => {
          if (!isGestureMode && !isNavigationMode && !isConfirmMode) {
            setIsGestureMode(true);
            speak('목적지 검색 모드로 전환합니다.');
            startListening?.();
          }
        }, 800);
      },
      onPanResponderMove: (_, g) => {
        if (Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5) {
          if (longPressTimeoutRef.current) {
            clearTimeout(longPressTimeoutRef.current);
            longPressTimeoutRef.current = null;
          }
        }
      },
      onPanResponderRelease: () => {
        if (longPressTimeoutRef.current) {
          clearTimeout(longPressTimeoutRef.current);
          longPressTimeoutRef.current = null;
        }
      },
      onPanResponderTerminationRequest: () => true,
      onPanResponderTerminate: () => {
        if (longPressTimeoutRef.current) {
          clearTimeout(longPressTimeoutRef.current);
          longPressTimeoutRef.current = null;
        }
      },
    })
  ).current;

  // ====== User Location ======
  useEffect(() => {
    const formatted = validateAndFormatCoordinate(userLocation);
    setSafeUserLocation(formatted || { latitude: 35.1796, longitude: 129.0756 });
  }, [userLocation, validateAndFormatCoordinate]);

  // ====== Route & Destination ======
  useEffect(() => {
    if (route) {
      setSafeWalkRoute(validateRouteArray(route.walk || []));
      setSafeSubwayRoute(validateRouteArray(route.subway || []));
      setSafeBusRoute(validateRouteArray(route.bus || []));
    } else {
      setSafeWalkRoute([]);
      setSafeSubwayRoute([]);
      setSafeBusRoute([]);
    }

    if (destination) {
      const d = validateAndFormatCoordinate(destination);
      setSafeDestination(d);
      if (d) didFitOnceRef.current = false;
    } else {
      setSafeDestination(null);
    }
  }, [route, destination, validateRouteArray, validateAndFormatCoordinate]);

  // ====== Instructions (dedupe) ======
  useEffect(() => {
    if (!Array.isArray(instructions)) {
      setSafeInstructions([]);
      return;
    }
    const seen = new Set();
    const out = [];
    for (const ins of instructions) {
      if (!ins || !ins.position) continue;
      const pos = validateAndFormatCoordinate(ins.position);
      if (!pos) continue;
      const desc = ins.description || '';
      const key = `${pos.latitude.toFixed(6)}:${pos.longitude.toFixed(6)}:${desc}:${ins.type || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...ins, position: pos, description: desc });
    }
    setSafeInstructions(out);
  }, [instructions, validateAndFormatCoordinate]);

  // ====== unified path ======
  useEffect(() => {
    const isTransit =
      (safeBusRoute && safeBusRoute.length >= 2) ||
      (safeSubwayRoute && safeSubwayRoute.length >= 2);

    if (!isTransit) {
      setUnifiedTransitPath([]);
      return;
    }

    let transitPath = [];
    if (safeBusRoute && safeBusRoute.length >= 2) transitPath = [...safeBusRoute];
    else if (safeSubwayRoute && safeSubwayRoute.length >= 2) transitPath = [...safeSubwayRoute];

    const uniquePath = [];
    const coordSet = new Set();
    for (const coord of transitPath) {
      if (!coord) continue;
      const key = `${coord.latitude.toFixed(6)}_${coord.longitude.toFixed(6)}`;
      if (!coordSet.has(key)) {
        coordSet.add(key);
        uniquePath.push(coord);
      }
    }
    setUnifiedTransitPath(uniquePath);
  }, [safeBusRoute, safeSubwayRoute]);

  // ====== recognizedText → 단발 처리 & 중복 방지 ======
  useEffect(() => {
    const q = recognizedText?.trim();
    if (!q) return;
    // 내비 중 또는 확인 모드에선 재진입 금지
    if (isNavigationMode || isConfirmMode) return;

    // 같은 쿼리를 5초 내 반복 방지
    const now = Date.now();
    if (now - lastQueryAtRef.current < 5000 && lastQueryRef.current === q) return;
    lastQueryRef.current = q;
    lastQueryAtRef.current = now;

    // 결과가 왔으니 즉시 음성 인식 종료 + 검색 배지 OFF
    stopListening?.();
    setIsGestureMode(false);

    if (confirmTimeoutRef.current) { clearTimeout(confirmTimeoutRef.current); confirmTimeoutRef.current = null; }
    startQueryFlow(q);
  }, [recognizedText, isNavigationMode, isConfirmMode, stopListening, startQueryFlow]);

  // ====== Unmount cleanup ======
  useEffect(() => {
    return () => {
      if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
      if (followCamTimer.current) clearTimeout(followCamTimer.current);
      // tts.stop?.();  // 필요시 사용
    };
  }, []);

  // ====== 상단 큰 지도: 사용자 따라가기(일반 모드) ======
  useEffect(() => {
    if (isNavigationMode || !safeUserLocation || !mapRef.current) return;
    if (followCamTimer.current) return;
    followCamTimer.current = setTimeout(() => {
      followCamTimer.current = null;
      try {
        mapRef.current.animateCamera?.(
          {
            latitude: safeUserLocation.latitude,
            longitude: safeUserLocation.longitude,
            zoom: 16.5,
            tilt: 45,
            bearing: 0,
          },
          600
        );
      } catch {}
    }, 450);
  }, [safeUserLocation, isNavigationMode]);

  // ====== Fit-once ======
  useEffect(() => {
    const all = unifiedTransitPath.length >= 2
      ? unifiedTransitPath
      : [...safeWalkRoute, ...safeSubwayRoute, ...safeBusRoute];

    if (!all.length || !mapRef.current) return;
    if (didFitOnceRef.current) return;
    didFitOnceRef.current = true;

    const minLat = Math.min(...all.map((p) => p.latitude));
    const maxLat = Math.max(...all.map((p) => p.latitude));
    const minLng = Math.min(...all.map((p) => p.longitude));
    const maxLng = Math.max(...all.map((p) => p.longitude));
    const center = {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
    };

    try {
      mapRef.current.animateCamera?.({ ...center, zoom: 15, tilt: 45, bearing: 0 }, 600);
    } catch {}
  }, [safeWalkRoute, safeSubwayRoute, safeBusRoute, unifiedTransitPath]);

  // ====== 어떤 경로를 그릴지 ======
  const renderMode = useMemo(() => {
    const hasBus = safeBusRoute && safeBusRoute.length >= 2;
    const hasSubway = safeSubwayRoute && safeSubwayRoute.length >= 2;
    if (hasBus || hasSubway) return 'transit';
    if (safeWalkRoute && safeWalkRoute.length >= 2) return 'walk';
    return 'none';
  }, [safeWalkRoute, safeBusRoute, safeSubwayRoute]);

  // ====== AR 회전/오프셋 계산 ======
  const routeHeadingDeg = useMemo(() => {
    const line = (renderMode === 'transit' ? unifiedTransitPath : safeWalkRoute);
    if (!safeUserLocation || !line || line.length < 2) return 0;

    // 현재 위치와 가장 가까운 점 → 다음 점 방위각
    let idx = 0, bestD = Infinity;
    for (let i = 0; i < line.length; i++) {
      const d = calculateDistance(
        safeUserLocation.latitude, safeUserLocation.longitude,
        line[i].latitude, line[i].longitude
      );
      if (d < bestD) { bestD = d; idx = i; }
    }
    const a = line[idx];
    const b = line[Math.min(idx + 1, line.length - 1)];
    const toRad = (x) => (x * Math.PI) / 180;
    const toDeg = (x) => (x * 180) / Math.PI;
    const dLon = toRad(b.longitude - a.longitude);
    const y = Math.sin(dLon) * Math.cos(toRad(b.latitude));
    const x =
      Math.cos(toRad(a.latitude)) * Math.sin(toRad(b.latitude)) -
      Math.sin(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }, [safeUserLocation, safeWalkRoute, unifiedTransitPath, renderMode]);

  // ✅ 경로(0.6) + 디바이스(0.4) 가중합
  const headingDeg = useMemo(() => {
    if (typeof deviceHeadingDeg === 'number') {
      return (0.6 * routeHeadingDeg + 0.4 * deviceHeadingDeg) % 360;
    }
    return routeHeadingDeg;
  }, [routeHeadingDeg, deviceHeadingDeg]);

  const lateralOffset = useMemo(() => {
    if (!currentDirection) return 0;
    if (currentDirection.includes('좌')) return -20;
    if (currentDirection.includes('우')) return  20;
    return 0;
  }, [currentDirection]);

  // ====== 미니맵 자동 추적 ======
  useEffect(() => {
    if (!isNavigationMode || !miniMapRef.current || !safeUserLocation) return;
    const now = Date.now();
    if (now - lastMiniCamAtRef.current < 400) return;
    lastMiniCamAtRef.current = now;
    try {
      miniMapRef.current.animateCamera?.(
        {
          latitude: safeUserLocation.latitude,
          longitude: safeUserLocation.longitude,
          zoom: 16,
          tilt: 0,
          bearing: headingDeg,
        },
        350
      );
    } catch {}
  }, [safeUserLocation, headingDeg, isNavigationMode]);

  // ====== UI ======
  if (!safeUserLocation) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text>위치 정보를 불러오는 중입니다...</Text>
      </View>
    );
  }

  if (mapError) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{mapError.message}</Text>
      </View>
    );
  }

  // ✅ 상단 모드 인디케이터(배지) 상태/색상
  const modeBadge = isConfirmMode || isGestureMode
    ? { label: '음성인식 모드', color: 'rgba(0, 120, 255, 0.9)' }
    : isNavigationMode
    ? { label: '경로 안내 모드', color: 'rgba(0, 176, 80, 0.9)' }
    : { label: '일반 모드', color: 'rgba(0, 0, 0, 0.7)' };

  // ✅ 하단 안내 모달 내용
  const dirEmoji =
    currentDirection === '앞' ? '⬆️' :
    currentDirection === '오른쪽' ? '➡️' :
    currentDirection === '왼쪽' ? '⬅️' :
    currentDirection === '뒤' ? '🔄' : '⬆️';

  const destLabel =
    (routeSummary && routeSummary.destinationName) ||
    recognizedDestination ||
    '목적지';

  return (
    <View style={styles.root}>
     {/* ✅ 모드 인디케이터(배지) — 루트에 고정 */}
      <View
      pointerEvents="none"
      style={[styles.modeIndicatorGlobal, { backgroundColor: modeBadge.color }]}
      >
      <Text style={styles.modeText}>{modeBadge.label}</Text>
      </View>
      {/* 상단: 지도 (애니메이션) */}
      <Animated.View style={[styles.topMapArea, { flex: topFlex }]} {...panResponder.panHandlers}>
        <NaverMapView
          ref={mapRef}
          style={styles.map}
          initialCamera={{
            latitude: safeUserLocation.latitude,
            longitude: safeUserLocation.longitude,
            zoom: 16.5,
            tilt: 45,
            bearing: 0,
          }}
          mapType="Basic"
          useTextureView={true}
          isShowLocationButton={true}
          isShowCompass={true}
          isShowScaleBar={false}
          isShowZoomControls={false}
          isShowIndoorLevelPicker={false}
          locationButtonStyle={{ position: 'absolute', bottom: 20, right: 20 }}
          onError={() => setMapError({ message: '지도 로딩 중 오류가 발생했습니다.' })}
        >
          {renderMode === 'walk' && safeWalkRoute.length >= 2 && (
            <NaverMapPathOverlay
              key="walk-path"
              coords={safeWalkRoute}
              width={8}
              color={'green'}
              outlineWidth={2}
              outlineColor={'white'}
            />
          )}
          {renderMode === 'transit' && unifiedTransitPath.length >= 2 && (
            <NaverMapPathOverlay
              key="transit-path"
              coords={unifiedTransitPath}
              width={8}
              color={'blue'}
              outlineWidth={2}
              outlineColor={'white'}
            />
          )}
          {safeDestination && (
            <NaverMapMarkerOverlay
              latitude={safeDestination.latitude}
              longitude={safeDestination.longitude}
              width={30}
              height={30}
              anchor={{ x: 0.5, y: 1 }}
              caption={{ text: '목적지' }}
              onTap={() => speak('목적지입니다.')}
            />
          )}
          {safeInstructions.map((instruction, idx) => (
            <NaverMapMarkerOverlay
              key={`ins-${instruction.position.latitude}-${instruction.position.longitude}-${idx}`}
              latitude={instruction.position.latitude}
              longitude={instruction.position.longitude}
              width={24}
              height={24}
              anchor={{ x: 0.5, y: 0.5 }}
              onTap={() => speak(instruction.description || '안내 정보가 없습니다')}
            />
          ))}
        </NaverMapView>

        {/* === 모드 버튼(기존 유지) === */}
        <View style={[styles.modeButtons, isNavigationMode && { transform: [{ scale: 0.9 }]}]}>
          <TouchableOpacity
            style={[styles.modeBtn, !isNavigationMode && styles.modeBtnActive]}
            onPress={() => { stopNavigation?.(); setIsNavigationMode?.(false); }}
          >
            {/* <Text style={styles.modeBtnText}>일반 모드</Text> */}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.modeBtn}
            onPress={() => { tts.speak('음성 검색을 시작합니다. 목적지를 말해주세요.', { priority: 10, type: 'ui' }); startListening?.(); setIsGestureMode(true); }}
          >
            {/* <Text style={styles.modeBtnText}>음성인식 모드</Text> */}
          </TouchableOpacity>
          <TouchableOpacity
            // style={[styles.modeBtn, isNavigationMode && styles.modeBtnPrimary]}
            onPress={() => { startNavigation?.(safeDestination || undefined); setIsNavigationMode?.(true); }}
          >
            {/* <Text style={[styles.modeBtnText, isNavigationMode && { color: '#fff' }]}>경로 안내 모드</Text> */}
          </TouchableOpacity>
        </View>

        {/* 일반 모드: 지도 하단 45% 터치 오버레이(더블탭/롱프레스) */}
        {!isNavigationMode && (
          <Pressable
            style={styles.bottomTouchOverlay}
            onPress={handleDoubleTapOrSingle}
            onLongPress={handleLongPress}
            delayLongPress={700}
          />
        )}
      </Animated.View>

      {/* 하단: 카메라/탐지 (내비 모드일 때만 표시) + 화살표 + 미니맵 */}
      <Animated.View style={[
        styles.bottomCameraArea,
        { flex: bottomFlex, height: isNavigationMode ? undefined : 0 }
      ]}>
        <ObstacleDetection
          isNavigating={isNavigationMode}
          userLocation={safeUserLocation}
          minimal={!showDetectDebug}
          autoStart={true}                      // ✅ 장애물 탐지 자동 시작
          onHeadingChange={(deg) => {
             // ❶ NaN 가드
             if (Number.isFinite(deg)) setDeviceHeadingDeg(deg);
           }}
        />


        {/* 미니맵 */}
        {isNavigationMode && (
          <View style={styles.miniMapWrap} pointerEvents="auto">
            <NaverMapView
              ref={miniMapRef}
              style={styles.miniMap}
              initialCamera={{
                latitude: safeUserLocation.latitude,
                longitude: safeUserLocation.longitude,
                zoom: 16,
                tilt: 0,
                bearing: headingDeg,
              }}
              isShowZoomControls={false}
              isShowScaleBar={false}
              isShowCompass={false}
              isNightMode={false}
            >
              {renderMode === 'walk' && safeWalkRoute.length >= 2 && (
                <NaverMapPathOverlay
                  key="walk-path-mini"
                  coords={safeWalkRoute}
                  width={6}
                  color={'#1976D2'}
                  outlineWidth={1}
                  outlineColor={'white'}
                />
              )}
              {renderMode === 'transit' && unifiedTransitPath.length >= 2 && (
                <NaverMapPathOverlay
                  key="transit-path-mini"
                  coords={unifiedTransitPath}
                  width={6}
                  color={'#1976D2'}
                  outlineWidth={1}
                  outlineColor={'white'}
                />
              )}
              {safeDestination && (
                <NaverMapMarkerOverlay
                  latitude={safeDestination.latitude}
                  longitude={safeDestination.longitude}
                  width={28}
                  height={28}
                  anchor={{ x: 0.5, y: 1 }}
                  caption={{ text: '목적지' }}
                />
              )}
            </NaverMapView>
          </View>
        )}

        {/* ✅ 하단 안내 모달: 화살표/목적지/남은거리/예상시간 */}
        {isNavigationMode && (
          <View style={styles.bottomBar} pointerEvents="none">
            <View style={styles.directionBadge}>
              <Text style={styles.directionEmoji}>{dirEmoji}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.destText} numberOfLines={1}>
                {destLabel}
                {nextStepLabel ? <Text style={styles.nextStepText}> · {nextStepLabel}</Text> : null}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                <View style={styles.pill}><Text style={styles.pillText}>남은 거리 {formatDistance(remainingDistance)}</Text></View>
                <View style={styles.pill}><Text style={styles.pillText}>예상 {formatTime(etaMinutes)}</Text></View>
              </View>
            </View>
          </View>
        )}

        {/* AR 모드: 전체 화면 터치(더블탭/롱프레스) */}
        {isNavigationMode && (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleDoubleTapOrSingle}
            onLongPress={handleLongPress}
            delayLongPress={700}
          />
        )}

       {/* ❷ 화살표는 항상 맨 마지막에, 높은 zIndex로 */}
       {isNavigationMode && (
         <ARDirectionalArrow
           visible={true}
           headingDeg={Number.isFinite(headingDeg) ? headingDeg : 0}
           lateralOffset={Number.isFinite(lateralOffset) ? lateralOffset : 0}
           size={160}
           assetFacingDeg={0}
        />
        )}
      </Animated.View>

      {/* ===== 아래는 테스트/확인/로딩 UI ===== */}
      <TouchableOpacity
        style={styles.testToggleButton}
        onPress={() => setTestInputVisible(!testInputVisible)}
      >
        <Text style={styles.testToggleText}>TEST</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.speechTestButton}
        onPress={() => tts.speak('음성 테스트입니다. 소리가 들리나요?', { priority: 5, type: 'ui' })}
      >
        <Text style={styles.testToggleText}>🔊</Text>
      </TouchableOpacity>

      {isConfirmMode && recognizedDestination && (
        <View style={styles.confirmContainer}>
          <Text style={styles.confirmText}>"{recognizedDestination}"으로 안내할까요?</Text>
          <Text style={styles.confirmSubtext}>확인: 한 번 탭 / 다음/취소: 두 번 탭</Text>
        </View>
      )}

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#0000ff" />
          <Text style={styles.loadingText}>검색 중입니다...</Text>
        </View>
      )}

      {testInputVisible && (
        <View style={styles.testInputContainer}>
          <Text style={styles.testLabel}>테스트 목적지 입력:</Text>
          <TextInput
            style={styles.testInput}
            value={testDestination}
            onChangeText={setTestDestination}
            placeholder="예: 부산역, 해운대해수욕장"
            placeholderTextColor="#999"
          />
          <View style={styles.testButtonContainer}>
            <TouchableOpacity
              style={styles.testButton}
              onPress={async () => {
                const q = testDestination.trim();
                if (!q) return;
                if (confirmTimeoutRef.current) { clearTimeout(confirmTimeoutRef.current); confirmTimeoutRef.current = null; }
                stopListening?.();
                setIsGestureMode(false);
                await startQueryFlow(q);
                setTestDestination('');
                setTestInputVisible(false);
              }}
            >
              <Text style={styles.testButtonText}>검색</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.testButton, styles.testButtonSecondary]}
              onPress={() => {
                setTestDestination('');
                setTestInputVisible(false);
              }}
            >
              <Text style={styles.testButtonText}>취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%', flexDirection: 'column' },
  modeIndicatorGlobal: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 18,
    zIndex: 1000,
    elevation: 1000,
  },
  // 높이는 Animated flex로 제어
  topMapArea: { width: '100%', overflow: 'hidden' },
  bottomCameraArea: {
    width: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
  },

  map: { flex: 1 },

  // 일반 모드에서 지도 하단 45%만 터치 받는 투명 오버레이
  bottomTouchOverlay: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    height: '45%',
    backgroundColor: 'transparent',
    zIndex: 50,
    elevation: 50,
  },

  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.8)', justifyContent: 'center', alignItems: 'center', zIndex: 20,
  },
  loadingText: { marginTop: 10, fontSize: 16, color: '#333', fontWeight: '500' },

  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#f8f8f8' },
  errorText: { fontSize: 16, fontWeight: 'bold', color: '#d32f2f', textAlign: 'center' },

  // ✅ 모드 인디케이터(배지)
  modeIndicator: {
    position: 'absolute', top: 16, alignSelf: 'center',
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 18, zIndex: 20,
  },
  modeText: { color: 'white', fontWeight: 'bold', fontSize: 13 },

 
  // 미니맵
  miniMapWrap: {
    position: 'absolute', top: 66, alignSelf: 'center',
    width: 350, height: 230, borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#fff', opacity: 0.96,
  },
  miniMap: { flex: 1 },

  // ✅ 하단 안내 바 (화살표/목적지/남은거리/예상시간)
  bottomBar: {
    position: 'absolute', left: 12, right: 12, bottom: 12,
    backgroundColor: 'rgba(24,24,24,0.75)', borderRadius: 16, padding: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  directionBadge: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  directionEmoji: { fontSize: 24 },
  destText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  nextStepText: { color: 'rgba(255,255,255,0.9)', fontWeight: '600', fontSize: 14 },
  pillar: { flexDirection: 'row', gap: 8, marginTop: 6 },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)' },
  pillActive: { backgroundColor: '#1DB954' },
  pillText: { color: '#fff', fontSize: 11 },

  // 테스트/확인 UI (원본 유지)
  testToggleButton: {
    position: 'absolute', bottom: 100, right: 20,
    width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(255, 0, 0, 0.8)',
    justifyContent: 'center', alignItems: 'center', zIndex: 100, elevation: 100,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84,
  },
  speechTestButton: {
    position: 'absolute', bottom: 100, right: 80,
    width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(0, 150, 255, 0.8)',
    justifyContent: 'center', alignItems: 'center', zIndex: 100, elevation: 100,
  },
  testToggleText: { color: 'white', fontSize: 12, fontWeight: 'bold' },

  confirmContainer: {
    position: 'absolute', top: 80, left: 20, right: 20,
    backgroundColor: 'rgba(66, 133, 244, 0.9)', padding: 15, borderRadius: 10, zIndex: 99,
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5,
  },
  confirmText: { color: 'white', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  confirmSubtext: { color: 'white', fontSize: 14, textAlign: 'center' },
  testInputContainer: {
    position: 'absolute', bottom: 160, left: 20, right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)', padding: 15, borderRadius: 10,
    zIndex: 99, elevation: 99,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84,
  },
  testLabel: { fontSize: 14, fontWeight: 'bold', marginBottom: 5, color: '#333' },
  testInput: {
    height: 40, borderWidth: 1, borderColor: '#ddd', borderRadius: 5,
    paddingHorizontal: 10, marginBottom: 10, backgroundColor: 'white', fontSize: 16,
  },
  testButtonContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  testButton: {
    flex: 1, height: 35, backgroundColor: '#007AFF', borderRadius: 5,
    justifyContent: 'center', alignItems: 'center', marginHorizontal: 5,
  },
  testButtonSecondary: { backgroundColor: '#999' },
  testButtonText: { color: 'white', fontSize: 14, fontWeight: 'bold' },
  quickSearchContainer: { borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 10 },
  quickSearchButtons: { flexDirection: 'row', flexWrap: 'wrap' },
  quickSearchButton: {
    backgroundColor: '#f0f0f0', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 15, marginRight: 5, marginBottom: 5,
  },
  quickSearchText: { fontSize: 12, color: '#333' },
});

export default MapView;
