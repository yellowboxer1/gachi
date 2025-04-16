import React, { useState, useRef, useEffect, useCallback } from 'react';
import { NaverMapView, NaverMapPathOverlay, NaverMapMarkerOverlay } from '@mj-studio/react-native-naver-map';
import { StyleSheet, View, Text, PanResponder, Dimensions, ActivityIndicator, Button } from 'react-native';
import * as Speech from 'expo-speech';
import { DEFAULT_LOCATION } from '../../utils/locationUtils';
import { getPoiCoordinates } from '../../services/tmapService';

// 좌표 유효성 검사
const isValidLatLng = (latitude, longitude) => {
  return (
    latitude !== undefined &&
    longitude !== undefined &&
    !isNaN(parseFloat(latitude)) &&
    !isNaN(parseFloat(longitude)) &&
    parseFloat(latitude) >= -90 &&
    parseFloat(latitude) <= 90 &&
    parseFloat(longitude) >= -180 &&
    parseFloat(longitude) <= 180
  );
};

// 좌표 포맷팅
const formatCoordinate = (coord) => {
  console.log('Raw coordinate input:', JSON.stringify(coord));
  if (!coord) return null;

  // 배열이면 첫 번째 요소를 선택
  const targetCoord = Array.isArray(coord) ? coord[0] : coord;
  if (!targetCoord) {
    console.error('No valid coordinate in array:', coord);
    return null;
  }

  const lat = typeof targetCoord.latitude === 'string' ? parseFloat(targetCoord.latitude) : targetCoord.latitude;
  const lng = typeof targetCoord.longitude === 'string' ? parseFloat(targetCoord.longitude) : targetCoord.longitude;

  if (isNaN(lat) || isNaN(lng)) {
    console.error('Invalid coordinate detected:', targetCoord);
    return null;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    console.error('Coordinate out of valid range:', { latitude: lat, longitude: lng });
    return null;
  }

  return { latitude: lat, longitude: lng };
};

// 음성 인식 훅
const useSpeechRecognition = () => {
  const start = useCallback(() => {
    console.log('음성 인식 시작');
    // 실제 음성 인식 로직
  }, []);

  const stop = useCallback(() => {
    console.log('음성 인식 중지');
    // 실제 중지 로직
  }, []);

  return { start, stop };
};

// 거리 계산 함수 (Haversine 공식)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // 지구 반지름 (미터)
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // 거리 (미터)
};

const MapView = ({
  userLocation,
  destination,
  route,
  instructions = [],
  nextInstruction,
  setRoute,
  startListening,
  stopListening,
  startNavigation,
  stopNavigation,
  onSpeechResult,
  searchDestination,
}) => {
  const [isGestureMode, setIsGestureMode] = useState(false);
  const [isConfirmMode, setIsConfirmMode] = useState(false);
  const [recognizedDestination, setRecognizedDestination] = useState(null);
  const [recognizedPoiList, setRecognizedPoiList] = useState([]); // 복수 POI 저장
  const [currentPoiIndex, setCurrentPoiIndex] = useState(0); // 현재 제시된 POI 인덱스
  const [isLoading, setIsLoading] = useState(false);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [mapError, setMapError] = useState(null);
  const mapRef = useRef(null);
  const [safeWalkRoute, setSafeWalkRoute] = useState([]);
  const [safeSubwayRoute, setSafeSubwayRoute] = useState([]);
  const [safeBusRoute, setSafeBusRoute] = useState([]);
  const [safeDestination, setSafeDestination] = useState(null);
  const [safeUserLocation, setSafeUserLocation] = useState(null);
  const [safeInstructions, setSafeInstructions] = useState([]);

  const lastTapTimeRef = useRef(0);
  const doubleTapTimeoutRef = useRef(null);
  const longPressTimeoutRef = useRef(null);
  const confirmTimeoutRef = useRef(null);

  const LONG_PRESS_DURATION = 800;
  const DOUBLE_TAP_DELAY = 250;
  const CONFIRM_TIMEOUT = 10000;

  const screenHeight = Dimensions.get('window').height;
  const halfScreenHeight = screenHeight / 2;

  const { start: startSpeech, stop: stopSpeech } = useSpeechRecognition();

  // 내비게이션 초기화
  const resetNavigation = useCallback(() => {
    console.log('내비게이션 상태 초기화');
    setIsNavigating(false);
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
    if (typeof setRoute === 'function') {
      setRoute(null);
    }
    if (typeof stopNavigation === 'function') {
      stopNavigation();
    }
    stopListening();
    stopSpeech();
    if (confirmTimeoutRef.current) {
      clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = null;
    }
    if (mapRef.current && safeUserLocation) {
      mapRef.current.animateToCoordinate(
        {
          latitude: safeUserLocation.latitude,
          longitude: safeUserLocation.longitude,
          zoom: 16.5,
        },
        1000
      );
    }
  }, [setRoute, stopNavigation, stopListening, stopSpeech, safeUserLocation]);

  // POI 제시 함수
  const presentPoi = useCallback(() => {
    console.log('presentPoi 호출 - recognizedPoiList:', JSON.stringify(recognizedPoiList), 'currentPoiIndex:', currentPoiIndex);
    if (recognizedPoiList.length === 0 || currentPoiIndex >= recognizedPoiList.length) {
      console.log('POI 소진, 초기화');
      resetNavigation();
      Speech.speak('검색 결과가 없습니다. 다시 검색해 주세요.', { language: 'ko-KR' });
      return;
    }

    const poiData = recognizedPoiList[currentPoiIndex];
    const cityName = poiData.upperAddrName || '';
    const locationInfo = cityName ? `${cityName}시에 위치한 ` : '';
    const confirmMessage = `${locationInfo}${recognizedDestination}를 검색하신 것 맞으실까요? 맞으면 화면을 한 번, 틀리면 두 번 눌러주세요.`;
    console.log('음성 안내 메시지:', confirmMessage);
    Speech.speak(confirmMessage, { language: 'ko-KR' });

    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    confirmTimeoutRef.current = setTimeout(() => {
      console.log('응답 시간 초과, 자동으로 검색 시작');
      setIsConfirmMode(false);
      Speech.speak('시간이 초과되어 자동으로 검색을 시작합니다.', { language: 'ko-KR' });
      if (typeof searchDestination === 'function') {
        searchDestination(recognizedDestination);
      } else {
        handleSearchDestination(recognizedDestination);
      }
    }, CONFIRM_TIMEOUT);
  }, [recognizedPoiList, currentPoiIndex, recognizedDestination, resetNavigation, searchDestination]);

  // 음성 인식 결과 처리
  const handleSpeechResult = async (result) => {
    console.log('handleSpeechResult 호출 - 결과:', result);
    if (result && result.trim() !== '') {
      setRecognizedDestination(result);
      setIsConfirmMode(true);
      setCurrentPoiIndex(0); // 항상 0으로 초기화
  
      try {
        setIsLoading(true);
        const poiDataList = await getPoiCoordinates(result, safeUserLocation);
        console.log('음성 인식 결과로 검색된 POI 데이터:', JSON.stringify(poiDataList));
  
        if (!Array.isArray(poiDataList) || poiDataList.length === 0) {
          console.warn('POI 데이터가 유효하지 않음:', poiDataList);
          Speech.speak('검색 결과가 없습니다.', { language: 'ko-KR' });
          resetNavigation();
          return;
        }

        const normalize = (str) => (str || '').replace(/\s+/g, '').trim();

        let matchedPois = poiDataList.filter(
          poi => normalize(poi.name) === normalize(result)
        );
        
        if (matchedPois.length === 0) {
          matchedPois = poiDataList.filter(
            poi => normalize(poi.name).includes(normalize(result))
          );
        }
        
        if (matchedPois.length === 0) {
          Speech.speak('정확한 장소를 찾을 수 없습니다.', { language: 'ko-KR' });
          resetNavigation();
          return;
        }
        
        const sortedPoiList = matchedPois
          .map(poi => ({
            ...poi,
            distance: safeUserLocation
              ? calculateDistance(
                  safeUserLocation.latitude,
                  safeUserLocation.longitude,
                  poi.latitude,
                  poi.longitude
                )
              : Infinity,
          }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 3);
        
        setRecognizedPoiList(sortedPoiList);
        setCurrentPoiIndex(0);
      } catch (error) {
        console.error('POI 검색 실패:', error);
        Speech.speak('검색 중 오류가 발생했습니다.', { language: 'ko-KR' });
        resetNavigation();
      } finally {
        setIsLoading(false);
      }
    } else {
      console.warn('유효하지 않은 음성 인식 결과:', result);
      Speech.speak('인식된 결과가 없습니다.', { language: 'ko-KR' });
      resetNavigation();
    }
  };

  // 확인 탭 처리
  const handleConfirmTap = (tapCount) => {
    console.log('handleConfirmTap 호출 - tapCount:', tapCount);
    if (confirmTimeoutRef.current) {
      clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = null;
    }
  
    if (tapCount === 1) {
      console.log('단일 탭 - 검색 시작');
      Speech.speak('검색을 시작합니다.', { language: 'ko-KR' });
      if (typeof searchDestination === 'function') {
        // 선택된 POI의 좌표를 전달
        const selectedPoi = recognizedPoiList[currentPoiIndex];
        if (selectedPoi) {
          searchDestination(recognizedDestination, {
            latitude: selectedPoi.latitude,
            longitude: selectedPoi.longitude,
          });
        } else {
          handleSearchDestination(recognizedDestination);
        }
      } else {
        handleSearchDestination(recognizedDestination);
      }
      setIsConfirmMode(false);
      setIsGestureMode(false);
    } else if (tapCount === 2) {
      console.log('더블 탭 - 다음 POI 또는 재검색');
      if (currentPoiIndex + 1 < recognizedPoiList.length) {
        Speech.speak('다음 검색 결과를 확인합니다.', { language: 'ko-KR' });
        setCurrentPoiIndex(prev => prev + 1);
        presentPoi();
      } else {
        Speech.speak('더 이상 검색 결과가 없습니다. 다시 검색해 주세요.', { language: 'ko-KR' });
        resetNavigation();
      }
    }
  };

  // 목적지 검색 
  const handleSearchDestination = async (query) => {
    try {
      setIsLoading(true);
      setIsRouteLoading(true);
      console.log('내부 검색 함수로 목적지 검색:', query);
  
      let coordinates;
      if (
        recognizedPoiList.length > 0 &&
        recognizedDestination === query &&
        currentPoiIndex < recognizedPoiList.length
      ) {
        coordinates = recognizedPoiList[currentPoiIndex];
        console.log('저장된 POI 데이터 사용:', JSON.stringify(coordinates));
      } else {
        const poiDataList = await getPoiCoordinates(query, safeUserLocation);
        coordinates = poiDataList[0] || null;
        console.log('검색 결과 좌표:', JSON.stringify(coordinates));
      }
  
      if (coordinates && isValidLatLng(coordinates.latitude, coordinates.longitude)) {
        console.log('목적지 유효함, 내비게이션 시작');
        Speech.speak('목적지를 찾았습니다. 경로를 탐색합니다.', { language: 'ko-KR' });
  
        const singleCoord = { latitude: coordinates.latitude, longitude: coordinates.longitude };
        setSafeDestination(singleCoord);
        startNavigationWithZoom(singleCoord);
        return true;
      } else {
        console.log('유효하지 않은 목적지:', coordinates);
        Speech.speak('목적지를 찾을 수 없습니다.', { language: 'ko-KR' });
        return false;
      }
    } catch (error) {
      console.error('목적지 검색 오류:', error);
      Speech.speak('검색 중 오류가 발생했습니다.', { language: 'ko-KR' });
      return false;
    } finally {
      setIsLoading(false);
      setIsRouteLoading(false);
    }
  };

  // 내비게이션 시작 및 줌
  const startNavigationWithZoom = (destination) => {
    console.log('내비게이션 줌 시작:', destination);
  
    if (isGestureMode) {
      setIsGestureMode(false);
      stopListening();
      stopSpeech();
    }
  
    if (mapRef.current) {
      try {
        mapRef.current.animateToCoordinate(
          {
            latitude: destination.latitude,
            longitude: destination.longitude,
            zoom: 18,
          },
          1000
        );
        console.log('지도 애니메이션 실행됨');
      } catch (error) {
        console.error('지도 애니메이션 오류:', error);
      }
    }
  
    setTimeout(() => {
      if (typeof startNavigation === 'function') {
        console.log('내비게이션 시작 함수 호출');
        startNavigation({ latitude: destination.latitude, longitude: destination.longitude });
        setIsNavigating(true);
      }
    }, 1500);
  };

  const handleMapError = (error) => {
    console.error('지도 컴포넌트 오류:', error);
    let errorMessage = '지도를 불러오는 중 오류가 발생했습니다.';
    if (error.message.includes('network')) {
      errorMessage = '네트워크 연결을 확인해주세요.';
    } else if (error.message.includes('API')) {
      errorMessage = '지도 서비스에 접속할 수 없습니다.';
    }
    setMapError({ message: errorMessage, details: error.toString() });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, gestureState) => {
        console.log('하단 영역 PanResponder granted');
        longPressTimeoutRef.current = setTimeout(() => {
          if (isConfirmMode) {
            if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
            setIsConfirmMode(false);
            setIsGestureMode(false);
            Speech.speak('확인되었습니다. 검색을 시작합니다.', { language: 'ko-KR' });
            if (typeof searchDestination === 'function') {
              searchDestination(recognizedDestination);
            } else {
              handleSearchDestination(recognizedDestination);
            }
            return;
          }
          if (!isGestureMode && !isNavigating) {
            setIsGestureMode(true);
            setIsConfirmMode(false);
            Speech.speak('목적지 검색 모드로 전환합니다.', { language: 'ko-KR' });
            startListening();
            startSpeech();
          }
        }, LONG_PRESS_DURATION);
      },
      onPanResponderMove: (evt, gestureState) => {
        if (Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5) {
          if (longPressTimeoutRef.current) {
            clearTimeout(longPressTimeoutRef.current);
            longPressTimeoutRef.current = null;
          }
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        console.log('터치 종료 감지');
        if (longPressTimeoutRef.current) {
          clearTimeout(longPressTimeoutRef.current);
          longPressTimeoutRef.current = null;
        }

        if (Math.abs(gestureState.dx) < 5 && Math.abs(gestureState.dy) < 5) {
          const now = Date.now();
          const timeSinceLastTap = now - (lastTapTimeRef.current || 0);
          console.log('마지막 탭 이후 시간:', timeSinceLastTap, 'ms');

          if (timeSinceLastTap < DOUBLE_TAP_DELAY && lastTapTimeRef.current !== 0) {
            console.log('더블 탭 감지');
            if (doubleTapTimeoutRef.current) {
              clearTimeout(doubleTapTimeoutRef.current);
              doubleTapTimeoutRef.current = null;
            }

            if (isConfirmMode) {
              handleConfirmTap(2);
            } else {
              Speech.speak('일반 모드로 전환합니다.', { language: 'ko-KR' });
              resetNavigation();
            }

            lastTapTimeRef.current = 0;
            return;
          } else {
            console.log('첫 탭 기록, 두 번째 탭 대기');
            lastTapTimeRef.current = now;

            if (doubleTapTimeoutRef.current) {
              clearTimeout(doubleTapTimeoutRef.current);
            }

            doubleTapTimeoutRef.current = setTimeout(() => {
              console.log('단일 탭 확인');
              if (isConfirmMode) {
                handleConfirmTap(1);
              } else if (!isGestureMode && safeDestination) {
                startNavigation(safeDestination);
              }
              lastTapTimeRef.current = 0;
              doubleTapTimeoutRef.current = null;
            }, DOUBLE_TAP_DELAY);
          }
        }
      },
      onPanResponderTerminate: () => {
        console.log('하단 영역 PanResponder terminated');
        if (longPressTimeoutRef.current) {
          clearTimeout(longPressTimeoutRef.current);
          longPressTimeoutRef.current = null;
        }
      },
    })
  ).current;

  const handleMapClick = (e) => {
    console.log('Map clicked', e);
    if (e && isValidLatLng(e.latitude, e.longitude)) {
      console.log('Valid map click at:', { latitude: e.latitude, longitude: e.longitude });
    }
  };

  // 사용자 위치 검증
  useEffect(() => {
    if (userLocation) {
      console.log('Raw user location:', JSON.stringify(userLocation));
      const formattedLocation = formatCoordinate(userLocation);
      if (formattedLocation) {
        setSafeUserLocation(formattedLocation);
        console.log('User location formatted:', formattedLocation);
      } else {
        console.warn('Invalid user location, using default');
        setSafeUserLocation(DEFAULT_LOCATION);
      }
    } else {
      setSafeUserLocation(DEFAULT_LOCATION);
    }
  }, [userLocation]);

  // 경로와 목적지 검증
  useEffect(() => {
    try {
      if (route) {
        console.log('Raw route data:', JSON.stringify(route));
        const validatedWalkRoute = route.walk?.map(formatCoordinate).filter(coord => coord) || [];
        console.log(`Walk route: ${route.walk?.length || 0} points -> ${validatedWalkRoute.length} valid points`);
        setSafeWalkRoute(validatedWalkRoute);
  
        const validatedSubwayRoute = route.subway?.map(formatCoordinate).filter(coord => coord) || [];
        console.log(`Subway route: ${route.subway?.length || 0} points -> ${validatedSubwayRoute.length} valid points`);
        setSafeSubwayRoute(validatedSubwayRoute);
  
        const validatedBusRoute = route.bus?.map(formatCoordinate).filter(coord => coord) || [];
        console.log(`Bus route: ${route.bus?.length || 0} points -> ${validatedBusRoute.length} valid points`);
        setSafeBusRoute(validatedBusRoute);
      } else {
        setSafeWalkRoute([]);
        setSafeSubwayRoute([]);
        setSafeBusRoute([]);
      }
  
      if (destination) {
        console.log('Raw destination data:', JSON.stringify(destination));
        const formattedDest = formatCoordinate(destination);
        console.log('Formatted destination:', formattedDest);
        if (!formattedDest) {
          console.warn('목적지 형식이 잘못되어 null로 설정');
        }
        setSafeDestination(formattedDest);
      } else {
        console.log('목적지가 제공되지 않음, null로 설정');
        setSafeDestination(null);
      }
    } catch (error) {
      console.error('경로 검증 중 오류 발생:', error);
      setSafeWalkRoute([]);
      setSafeSubwayRoute([]);
      setSafeBusRoute([]);
      setSafeDestination(null);
    }
  }, [route, destination]);

  // 내비게이션 모드 설정
  useEffect(() => {
    if (route && (safeWalkRoute.length > 0 || safeSubwayRoute.length > 0 || safeBusRoute.length > 0)) {
      setIsNavigating(true);
    } else {
      setIsNavigating(false);
    }
  }, [safeWalkRoute, safeSubwayRoute, safeBusRoute, route]);

  // 안내 지점 검증
  useEffect(() => {
    if (instructions && Array.isArray(instructions)) {
      console.log('Raw instructions data:', JSON.stringify(instructions));
      const validInstructions = instructions
        .map((instruction, index) => {
          if (!instruction || !instruction.position) {
            console.warn(`Instruction at index ${index} is invalid or missing position`, instruction);
            return null;
          }
          const validPosition = formatCoordinate(instruction.position);
          if (!validPosition) {
            console.warn(`Invalid position for instruction at index ${index}`, instruction.position);
            return null;
          }
          return { ...instruction, position: validPosition };
        })
        .filter(instruction => instruction !== null);
      console.log(`Instructions validated: ${instructions.length} total -> ${validInstructions.length} valid positions`);
      setSafeInstructions(validInstructions);
    } else {
      console.log('No valid instructions provided');
      setSafeInstructions([]);
    }
  }, [instructions]);

  // 음성 인식 결과 처리
  useEffect(() => {
    if (onSpeechResult) {
      onSpeechResult(handleSpeechResult);
    }
  }, [onSpeechResult]);

  // 컴포넌트 마운트/언마운트
  useEffect(() => {
    console.log('MapView component mounted');
    return () => {
      console.log('MapView component unmounting, clearing timers');
      if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
      if (doubleTapTimeoutRef.current) clearTimeout(doubleTapTimeoutRef.current);
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    };
  }, []);

  // 제스처 모드 로그
  useEffect(() => {
    console.log('Gesture mode 상태 변경됨:', isGestureMode ? 'ON' : 'OFF');
    if (!isGestureMode) {
      console.log('음성 검색 모드 해제됨');
    }
  }, [isGestureMode]);

  // 확인 모드 로그
  useEffect(() => {
    console.log('Confirm mode changed:', isConfirmMode ? 'ON' : 'OFF');
  }, [isConfirmMode]);

  useEffect(() => {
    if (
      isConfirmMode &&
      recognizedPoiList.length > 0 &&
      currentPoiIndex < recognizedPoiList.length
    ) {
      presentPoi();
    }
  }, [recognizedPoiList, currentPoiIndex, isConfirmMode]);

  // 마커 아이콘
  const getMarkerImageForType = (type) => {
    switch (type) {
      case 'crosswalk':
        return require('../../assets/images/crosswalk_icon.png');
      case 'subway':
        return require('../../assets/images/subway_icon.png');
      case 'bus':
        return require('../../assets/images/bus_icon.png');
      case 'stairs':
        return require('../../assets/images/stairs_icon.png');
      case 'overpass':
        return require('../../assets/images/overpass_icon.png');
      case 'underground':
        return require('../../assets/images/underground_icon.png');
      case 'ramp':
        return require('../../assets/images/ramp_icon.png');
      case 'stairsramp':
        return require('../../assets/images/stairsramp_icon.png');
      case 'left':
        return require('../../assets/images/left_icon.png');
      case 'right':
        return require('../../assets/images/right_icon.png');
      case 'straight':
        return require('../../assets/images/straight_icon.png');
      case 'destination':
        return require('../../assets/images/destination_icon.png');
      default:
        return require('../../assets/images/direction_icon.png');
    }
  };

  // 로딩 화면
  if (!safeUserLocation) {
    return (
      <View style={styles.loadingContainer}>
        <Text>위치 정보를 불러오는 중입니다...</Text>
      </View>
    );
  }

  // 오류 화면
  if (mapError) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{mapError.message}</Text>
        <Text style={styles.errorSubtext}>{mapError.details}</Text>
        <Button title="재시도" onPress={() => setMapError(null)} />
      </View>
    );
  }

  // 카메라 설정
  const cameraPosition = {
    latitude: safeUserLocation.latitude,
    longitude: safeUserLocation.longitude,
    zoom: 16.5,
    tilt: 45,
    bearing: 0,
  };

  return (
    <View style={styles.mapContainer}>
      <NaverMapView
        ref={mapRef}
        style={styles.map}
        camera={cameraPosition}
        isShowLocationButton={true}
        isZoomGesturesEnabled={true}
        isScrollGesturesEnabled={true}
        isRotateGesturesEnabled={true}
        isTiltGesturesEnabled={true}
        isShowCompass={true}
        onTapMap={handleMapClick}
        onError={handleMapError}
        layerGroups={{
          BICYCLE: false,
          BUILDING: true,
          CADASTRAL: false,
          MOUNTAIN: false,
          TRAFFIC: false,
          TRANSIT: true,
        }}
      >
        {safeWalkRoute.length >= 2 &&
          safeWalkRoute.every(coord => isValidLatLng(coord.latitude, coord.longitude)) && (
            <NaverMapPathOverlay
              coords={safeWalkRoute}
              width={10}
              color="#D4D8E3"
              pattern={[10, 10]}
              outlineWidth={0}
            />
          )}
        {safeSubwayRoute.length >= 2 &&
          safeSubwayRoute.every(coord => isValidLatLng(coord.latitude, coord.longitude)) && (
            <NaverMapPathOverlay
              coords={safeSubwayRoute}
              width={10}
              color="#F06A00"
              outlineWidth={2}
              outlineColor="#FFFFFF"
            />
          )}
        {safeBusRoute.length >= 2 &&
          safeBusRoute.every(coord => isValidLatLng(coord.latitude, coord.longitude)) && (
            <NaverMapPathOverlay
              coords={safeBusRoute}
              width={10}
              color="#3BB548"
              outlineWidth={2}
              outlineColor="#FFFFFF"
            />
          )}
        {safeDestination && isValidLatLng(safeDestination.latitude, safeDestination.longitude) && (
          <NaverMapMarkerOverlay
            latitude={safeDestination.latitude}
            longitude={safeDestination.longitude}
            width={24}
            height={24}
            anchor={{ x: 0.5, y: 1 }}
            image={require('../../assets/images/destination_icon.png')}
            onClick={() => Speech.speak('목적지입니다.', { language: 'ko-KR' })}
          />
        )}
        {safeInstructions.length > 0 &&
          safeInstructions.map((instruction, index) => {
            if (!instruction.position || !isValidLatLng(instruction.position.latitude, instruction.position.longitude)) {
              console.warn(`Skipping invalid instruction at index ${index}`, instruction);
              return null;
            }
            return (
              <NaverMapMarkerOverlay
                key={`instruction-${index}`}
                latitude={instruction.position.latitude}
                longitude={instruction.position.longitude}
                width={24}
                height={24}
                anchor={{ x: 0.5, y: 0.5 }}
                image={getMarkerImageForType(instruction.type)}
                onClick={() => Speech.speak(instruction.description || '안내 정보가 없습니다', { language: 'ko-KR' })}
              />
            );
          })}
      </NaverMapView>

      <View
        style={[
          styles.gestureOverlay,
          {
            top: halfScreenHeight,
            height: halfScreenHeight,
            backgroundColor: isGestureMode ? 'rgba(0, 0, 0, 0.05)' : 'transparent',
          },
        ]}
        {...panResponder.panHandlers}
      />

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#0000ff" />
          <Text style={styles.loadingText}>목적지를 검색하는 중입니다...</Text>
        </View>
      )}

      {isRouteLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#0000ff" />
          <Text style={styles.loadingText}>경로를 계산하는 중입니다...</Text>
        </View>
      )}

      <View
        style={[
          styles.modeIndicator,
          {
            backgroundColor: isConfirmMode
              ? 'rgba(255, 153, 0, 0.9)'
              : isGestureMode
              ? 'rgba(0, 120, 255, 0.9)'
              : isNavigating
              ? 'rgba(0, 176, 80, 0.9)'
              : 'rgba(0, 0, 0, 0.7)',
          },
        ]}
      >
        <Text style={styles.modeText}>
          {isConfirmMode ? '확인 모드' : isGestureMode ? '음성 검색 모드' : isNavigating ? '경로 안내 모드' : '일반 모드'}
        </Text>
      </View>

      {isConfirmMode && recognizedDestination && (
        <View style={styles.confirmContainer}>
          <Text style={styles.confirmText}>"{recognizedDestination}"으로 안내할까요?</Text>
          <Text style={styles.confirmSubtext}>확인: 한 번 탭 / 취소: 두 번 탭</Text>
        </View>
      )}

      {nextInstruction && !isConfirmMode && (
        <View style={styles.nextInstructionContainer}>
          <Text style={styles.nextInstructionText}>{nextInstruction.description || '다음 안내'}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  mapContainer: {
    flex: 1,
    width: '100%',
    position: 'relative',
  },
  map: {
    flex: 1,
    width: '100%',
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#333',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f8f8f8',
  },
  errorText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#d32f2f',
    marginBottom: 8,
  },
  errorSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  modeIndicator: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    zIndex: 10,
  },
  modeText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  gestureOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 5,
  },
  confirmContainer: {
    position: 'absolute',
    top: 80,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(66, 133, 244, 0.9)',
    padding: 15,
    borderRadius: 10,
    zIndex: 15,
    alignItems: 'center',
  },
  confirmText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  confirmSubtext: {
    color: 'white',
    fontSize: 14,
    textAlign: 'center',
  },
  nextInstructionContainer: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 15,
    borderRadius: 10,
    zIndex: 10,
  },
  nextInstructionText: {
    color: 'white',
    fontSize: 16,
    textAlign: 'center',
  },
});

export default MapView;