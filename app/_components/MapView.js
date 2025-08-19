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
  Dimensions,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import * as Speech from 'expo-speech';
import { getPoiCoordinates } from '../../services/naverService'; // ✅ 검색은 네이버 API
import { calculateDistance } from '../../utils/locationUtils';

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

  // unified path (대중교통 경로일 때 instructions를 따라 하나로 이어붙인 라인)
  const [unifiedTransitPath, setUnifiedTransitPath] = useState([]);

  // ====== Refs ======
  const mapRef = useRef(null);
  const lastTapTimeRef = useRef(0);
  const doubleTapTimeoutRef = useRef(null);
  const longPressTimeoutRef = useRef(null);
  const confirmTimeoutRef = useRef(null);
  const didFitOnceRef = useRef(false);
  const followCamTimer = useRef(null);
  const navInFlightRef = useRef(false);

  // ====== Const ======
  const LONG_PRESS_DURATION = 800;
  const DOUBLE_TAP_DELAY = 380;
  const CONFIRM_TIMEOUT = 10000;
  const screenHeight = Dimensions.get('window').height;
  const halfScreenHeight = screenHeight / 2;
  const DEFAULT_LOCATION = { latitude: 35.1796, longitude: 129.0756 };

  // ====== Speech util ======
  const speak = useCallback(async (text) => {
    try { await Speech.stop(); } catch {}
    Speech.speak(text, { language: 'ko-KR' });
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

    if (typeof stopListening === 'function') stopListening();
    if (confirmTimeoutRef.current) {
      clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = null;
    }
  }, [stopListening]);

  // ====== POI 제시 ======
  const presentPoi = useCallback((list, index) => {
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
      speak('시간이 초과되어 자동으로 경로를 탐색합니다.');
      handleSearchDestination(lockedName, true);
    }, CONFIRM_TIMEOUT);
  }, [recognizedPoiList, currentPoiIndex, resetNavigation, speak]);

  // ====== 음성/텍스트 공통 검색 시작 (네이버 검색) ======
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
              // eslint-disable-next-line no-await-in-loop
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

      // 스코어링 정렬
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

  // ====== 음성 인식 결과 → 공통 플로우 ======
  const handleSpeechResult = async (result) => {
    if (confirmTimeoutRef.current) { clearTimeout(confirmTimeoutRef.current); confirmTimeoutRef.current = null; }
    if (!result || !result.trim()) {
      speak('인식된 결과가 없습니다.');
      resetNavigation();
      return;
    }
    await startQueryFlow(result.trim());
  };

  // ====== 확인 탭 처리 ======
  const handleConfirmTap = (tapCount) => {
    if (confirmTimeoutRef.current) { 
      clearTimeout(confirmTimeoutRef.current); 
      confirmTimeoutRef.current = null; 
    }

    if (tapCount === 1) {
      // 싱글탭: 목적지 확정 및 경로 탐색
      speak('경로를 탐색합니다.');
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
      // 더블탭: 다음 검색 결과 또는 취소
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

        navInFlightRef.current = true;
        setTimeout(() => {
          if (typeof startNavigation === 'function') {
            startNavigation({ latitude: coordinates.latitude, longitude: coordinates.longitude });
            if (typeof setIsNavigationMode === 'function') setIsNavigationMode(true);
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

  // ====== 하단 제스처 레이어 ======
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,
      onPanResponderGrant: () => {
        // 롱프레스 타이머 시작
        longPressTimeoutRef.current = setTimeout(() => {
          if (!isGestureMode && !isNavigationMode && !isConfirmMode) {
            setIsGestureMode(true);
            speak('목적지 검색 모드로 전환합니다.');
            if (typeof startListening === 'function') startListening();
          }
        }, LONG_PRESS_DURATION);
      },
      onPanResponderMove: (_, g) => {
        // 움직임 감지시 롱프레스 취소
        if (Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5) {
          if (longPressTimeoutRef.current) {
            clearTimeout(longPressTimeoutRef.current);
            longPressTimeoutRef.current = null;
          }
        }
      },
      onPanResponderRelease: (_, g) => {
        // 롱프레스 타이머 정리
        if (longPressTimeoutRef.current) {
          clearTimeout(longPressTimeoutRef.current);
          longPressTimeoutRef.current = null;
        }
        
        // 탭 처리 (이동이 5픽셀 미만인 경우)
        if (Math.abs(g.dx) < 5 && Math.abs(g.dy) < 5) {
          const now = Date.now();
          const delta = now - lastTapTimeRef.current;
          
          // 더블탭 감지
          if (delta < DOUBLE_TAP_DELAY && lastTapTimeRef.current !== 0) {
            // 이전 싱글탭 타이머 취소
            if (doubleTapTimeoutRef.current) {
              clearTimeout(doubleTapTimeoutRef.current);
              doubleTapTimeoutRef.current = null;
            }
            
            // 더블탭 처리
            lastTapTimeRef.current = 0;
            
            if (isConfirmMode) {
              // 확인 모드에서 더블탭: 다음 검색 결과
              handleConfirmTap(2);
            } else if (isNavigationMode) {
              // 내비게이션 모드에서 더블탭: 내비게이션 종료
              speak('내비게이션을 종료합니다.');
              if (typeof stopNavigation === 'function') stopNavigation();
              if (typeof setIsNavigationMode === 'function') setIsNavigationMode(false);
              resetNavigation();
            }
          } else {
            // 싱글탭 (지연 처리)
            lastTapTimeRef.current = now;
            doubleTapTimeoutRef.current = setTimeout(() => {
              // 싱글탭 처리
              if (isConfirmMode) {
                // 확인 모드에서 싱글탭: 목적지 확정
                handleConfirmTap(1);
              }
              lastTapTimeRef.current = 0;
            }, DOUBLE_TAP_DELAY);
          }
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
    setSafeUserLocation(formatted || DEFAULT_LOCATION);
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

  // ====== unified path 만들기 (대중교통 경로인 경우) ======
  useEffect(() => {
    // 대중교통이면 route.bus 또는 route.subway에 좌표가 존재
    const isTransit =
      (safeBusRoute && safeBusRoute.length >= 2) ||
      (safeSubwayRoute && safeSubwayRoute.length >= 2);

    if (!isTransit) {
      setUnifiedTransitPath([]);
      return;
    }

    // 대중교통 경로가 있을 때는 대중교통 경로만 표시
    // (도보 경로는 대중교통 탑승 전후 구간이므로 제외)
    let transitPath = [];
    
    if (safeBusRoute && safeBusRoute.length >= 2) {
      transitPath = [...safeBusRoute];
    } else if (safeSubwayRoute && safeSubwayRoute.length >= 2) {
      transitPath = [...safeSubwayRoute];
    }
    
    // 중복 제거
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

  // ====== recognizedText → 공통 플로우 ======
  useEffect(() => {
    if (recognizedText && recognizedText.trim()) {
      if (confirmTimeoutRef.current) { clearTimeout(confirmTimeoutRef.current); confirmTimeoutRef.current = null; }
      startQueryFlow(recognizedText.trim());
    }
  }, [recognizedText, startQueryFlow]);

  // ====== Unmount cleanup ======
  useEffect(() => {
    return () => {
      if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
      if (doubleTapTimeoutRef.current) clearTimeout(doubleTapTimeoutRef.current);
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
      if (followCamTimer.current) clearTimeout(followCamTimer.current);
      Speech.stop();
    };
  }, []);

  // ====== Follow Camera ======
  useEffect(() => {
    if (!isNavigationMode || !safeUserLocation || !mapRef.current) return;
    if (followCamTimer.current) return;
    followCamTimer.current = setTimeout(() => {
      followCamTimer.current = null;
      try {
        mapRef.current.animateCamera?.(
          {
            latitude: safeUserLocation.latitude,
            longitude: safeUserLocation.longitude,
            zoom: 17,
            tilt: 30,
            bearing: 0,
          },
          600
        );
      } catch {}
    }, 450);
  }, [safeUserLocation, isNavigationMode]);

  // ====== Fit-once after route received ======
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
      mapRef.current.animateCamera?.({ ...center, zoom: 15, tilt: 0, bearing: 0 }, 600);
    } catch {}
  }, [safeWalkRoute, safeSubwayRoute, safeBusRoute, unifiedTransitPath]);

  // ====== 어떤 경로를 그릴지 결정 ======
  const renderMode = useMemo(() => {
    // 버스나 지하철 경로가 있으면 대중교통 모드
    const hasBus = safeBusRoute && safeBusRoute.length >= 2;
    const hasSubway = safeSubwayRoute && safeSubwayRoute.length >= 2;
    
    if (hasBus || hasSubway) {
      return 'transit'; // 파란색 단일 경로
    }
    
    // 도보 경로만 있으면 도보 모드
    if (safeWalkRoute && safeWalkRoute.length >= 2) {
      return 'walk'; // 초록색
    }
    
    return 'none';
  }, [safeWalkRoute, safeBusRoute, safeSubwayRoute]);

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

  return (
    <View style={styles.mapContainer}>
      <NaverMapView
        ref={mapRef}
        style={styles.map}
        initialCamera={{
          latitude: safeUserLocation.latitude,
          longitude: safeUserLocation.longitude,
          zoom: 16.5,
          tilt: 0,
          bearing: 0,
        }}
        mapType="Basic"
        isShowLocationButton={true}
        isShowCompass={true}
        isShowScaleBar={false}
        isShowZoomControls={false}
        isShowIndoorLevelPicker={false}
        locationButtonStyle={{ position: 'absolute', bottom: 20, right: 20 }}
        onError={() => setMapError({ message: '지도 로딩 중 오류가 발생했습니다.' })}
      >
        {/* ====== 단일 경로만 그림 ====== */}
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

        {/* 목적지 */}
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

        {/* 안내 포인트 (중복 제거됨) */}
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

      {/* 하단 제스처 레이어 */}
      <View
        style={[
          styles.gestureOverlay,
          {
            top: halfScreenHeight,
            height: halfScreenHeight,
            backgroundColor: isGestureMode ? 'rgba(0, 0, 0, 0.04)' : 'transparent',
          },
        ]}
        pointerEvents={testInputVisible || isConfirmMode ? 'none' : 'auto'}
        collapsable={false}
        {...panResponder.panHandlers}
      />

      {/* Loading */}
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#0000ff" />
          <Text style={styles.loadingText}>검색 중입니다...</Text>
        </View>
      )}

      {/* Mode pill */}
      <View
        style={[
          styles.modeIndicator,
          {
            backgroundColor: isConfirmMode
              ? 'rgba(255, 153, 0, 0.9)'
              : isGestureMode
              ? 'rgba(0, 120, 255, 0.9)'
              : isNavigationMode
              ? 'rgba(0, 176, 80, 0.9)'
              : 'rgba(0, 0, 0, 0.7)',
          },
        ]}
      >
        <Text style={styles.modeText}>
          {isConfirmMode
            ? '확인 모드'
            : isGestureMode
            ? '음성 검색 모드'
            : isNavigationMode
            ? '경로 안내 모드'
            : '일반 모드'}
        </Text>
      </View>

      {/* Confirm banner */}
      {isConfirmMode && recognizedDestination && (
        <View style={styles.confirmContainer}>
          <Text style={styles.confirmText}>"{recognizedDestination}"으로 안내할까요?</Text>
          <Text style={styles.confirmSubtext}>확인: 한 번 탭 / 다음/취소: 두 번 탭</Text>
        </View>
      )}

      {/* ==== Test UI ==== */}
      <TouchableOpacity
        style={styles.testToggleButton}
        onPress={() => setTestInputVisible(!testInputVisible)}
      >
        <Text style={styles.testToggleText}>TEST</Text>
      </TouchableOpacity>

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
                if (testDestination.trim()) {
                  if (confirmTimeoutRef.current) { clearTimeout(confirmTimeoutRef.current); confirmTimeoutRef.current = null; }
                  await startQueryFlow(testDestination.trim());
                  setTestDestination('');
                  setTestInputVisible(false);
                }
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

          <View style={styles.quickSearchContainer}>
            <Text style={styles.quickSearchLabel}>빠른 검색:</Text>
            <View style={styles.quickSearchButtons}>
              {['부산역', '해운대해수욕장', '센텀시티', '광안리해수욕장'].map((q) => (
                <TouchableOpacity
                  key={q}
                  style={styles.quickSearchButton}
                  onPress={async () => {
                    if (confirmTimeoutRef.current) { clearTimeout(confirmTimeoutRef.current); confirmTimeoutRef.current = null; }
                    await startQueryFlow(q);
                    setTestInputVisible(false);
                  }}
                >
                  <Text style={styles.quickSearchText}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  mapContainer: { flex: 1, width: '100%', position: 'relative' },
  map: { flex: 1, width: '100%', position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },

  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.8)', justifyContent: 'center', alignItems: 'center', zIndex: 20,
  },
  loadingText: { marginTop: 10, fontSize: 16, color: '#333', fontWeight: '500' },

  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#f8f8f8' },
  errorText: { fontSize: 16, fontWeight: 'bold', color: '#d32f2f', textAlign: 'center' },

  modeIndicator: {
    position: 'absolute', top: 20, alignSelf: 'center',
    paddingVertical: 8, paddingHorizontal: 15, borderRadius: 20, zIndex: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5,
  },
  modeText: { color: 'white', fontWeight: 'bold', fontSize: 14 },

  gestureOverlay: { position: 'absolute', left: 0, right: 0, zIndex: 50, elevation: 50 },

  confirmContainer: {
    position: 'absolute', top: 80, left: 20, right: 20,
    backgroundColor: 'rgba(66, 133, 244, 0.9)', padding: 15, borderRadius: 10, zIndex: 15,
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5,
  },
  confirmText: { color: 'white', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  confirmSubtext: { color: 'white', fontSize: 14, textAlign: 'center' },

  // Test UI
  testToggleButton: {
    position: 'absolute', bottom: 100, right: 20,
    width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(255, 0, 0, 0.8)',
    justifyContent: 'center', alignItems: 'center', zIndex: 100, elevation: 100,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84,
  },
  testToggleText: { color: 'white', fontSize: 12, fontWeight: 'bold' },
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
  quickSearchLabel: { fontSize: 12, color: '#666', marginBottom: 5 },
  quickSearchButtons: { flexDirection: 'row', flexWrap: 'wrap' },
  quickSearchButton: {
    backgroundColor: '#f0f0f0', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 15, marginRight: 5, marginBottom: 5,
  },
  quickSearchText: { fontSize: 12, color: '#333' },
});

export default MapView;