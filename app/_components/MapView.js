import React, { useEffect, useState, useRef } from 'react';
import { NaverMapView, NaverMapPathOverlay, NaverMapMarkerOverlay } from '@mj-studio/react-native-naver-map';
import { StyleSheet, View, Text, PanResponder, Dimensions } from 'react-native';
import * as Speech from 'expo-speech';
import { DEFAULT_LOCATION } from '../../utils/locationUtils';

// 개선된 좌표 유효성 검사 함수
const isValidLatLng = (latitude, longitude) => {
  return latitude !== undefined && 
         longitude !== undefined && 
         !isNaN(parseFloat(latitude)) && 
         !isNaN(parseFloat(longitude)) &&
         parseFloat(latitude) >= -90 && 
         parseFloat(latitude) <= 90 &&
         parseFloat(longitude) >= -180 && 
         parseFloat(longitude) <= 180;
};

// 개선된 좌표 포맷팅 함수
const formatCoordinate = (coord) => {
  console.log('Raw coordinate input:', JSON.stringify(coord));
  if (!coord) return null;
  
  // 문자열 또는 숫자 형태로 들어올 수 있으므로 모두 처리
  const lat = typeof coord.latitude === 'string' ? parseFloat(coord.latitude) : coord.latitude;
  const lng = typeof coord.longitude === 'string' ? parseFloat(coord.longitude) : coord.longitude;
  
  if (isNaN(lat) || isNaN(lng)) {
    console.error('Invalid coordinate detected:', coord);
    return null;
  }
  
  // 유효 범위 검사 (-90~90 위도, -180~180 경도)
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    console.error('Coordinate out of valid range:', { latitude: lat, longitude: lng });
    return null;
  }
  
  return { latitude: lat, longitude: lng };
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
    startNavigation
}) => {
    const [isGestureMode, setIsGestureMode] = useState(false);
    const mapRef = useRef(null);
    const [mapError, setMapError] = useState(null);

    // 안전한 경로 데이터를 저장하기 위한 상태
    const [safeWalkRoute, setSafeWalkRoute] = useState([]);
    const [safeSubwayRoute, setSafeSubwayRoute] = useState([]);
    const [safeBusRoute, setSafeBusRoute] = useState([]);
    const [safeDestination, setSafeDestination] = useState(null);
    const [safeUserLocation, setSafeUserLocation] = useState(null);
    const [safeInstructions, setSafeInstructions] = useState([]);

    // 제스처 감지를 위한 변수들
    const lastTapTimeRef = useRef(0);
    const doubleTapTimeoutRef = useRef(null);
    const longPressTimeoutRef = useRef(null);

    // 롱프레스 및 더블탭 감지 시간
    const LONG_PRESS_DURATION = 800; // 0.8초 유지
    const DOUBLE_TAP_DELAY = 300; // 0.3초 이내

    // 화면 높이 계산
    const screenHeight = Dimensions.get('window').height;
    const halfScreenHeight = screenHeight / 2;

    // 지도 오류 처리 함수
    const handleMapError = (error) => {
        console.error('지도 컴포넌트 오류:', error);
        setMapError(error);
        // 필요 시 사용자에게 오류 메시지 표시
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

    // 경로와 목적지 데이터 검증
    useEffect(() => {
        try {
            if (route) {
                console.log('Raw route data:', JSON.stringify(route));
                
                // 도보 경로 검증
                const validatedWalkRoute = route.walk?.map(formatCoordinate).filter(coord => coord) || [];
                console.log(`Walk route: ${route.walk?.length || 0} points -> ${validatedWalkRoute.length} valid points`);
                setSafeWalkRoute(validatedWalkRoute);
                
                // 지하철 경로 검증
                const validatedSubwayRoute = route.subway?.map(formatCoordinate).filter(coord => coord) || [];
                console.log(`Subway route: ${route.subway?.length || 0} points -> ${validatedSubwayRoute.length} valid points`);
                setSafeSubwayRoute(validatedSubwayRoute);
                
                // 버스 경로 검증
                const validatedBusRoute = route.bus?.map(formatCoordinate).filter(coord => coord) || [];
                console.log(`Bus route: ${route.bus?.length || 0} points -> ${validatedBusRoute.length} valid points`);
                setSafeBusRoute(validatedBusRoute);
            } else {
                setSafeWalkRoute([]);
                setSafeSubwayRoute([]);
                setSafeBusRoute([]);
            }
            
            // 목적지 검증
            if (destination) {
                console.log('Raw destination data:', JSON.stringify(destination));
                const formattedDest = formatCoordinate(destination);
                console.log('Formatted destination:', formattedDest);
                setSafeDestination(formattedDest);
            } else {
                setSafeDestination(null);
            }
        } catch (error) {
            console.error('경로 검증 중 오류 발생:', error);
            // 오류 발생 시 빈 경로로 초기화
            setSafeWalkRoute([]);
            setSafeSubwayRoute([]);
            setSafeBusRoute([]);
        }
    }, [route, destination]);

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
            
            console.log(`Instructions validated: ${instructions.length} total -> ${validInstructions.length} with valid positions`);
            setSafeInstructions(validInstructions);
        } else {
            console.log('No valid instructions provided');
            setSafeInstructions([]);
        }
    }, [instructions]);

    // 제스처 감지 PanResponder
    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => {
                console.log('onStartShouldSetPanResponder triggered');
                return true; // 터치 이벤트 감지 허용
            },
            onPanResponderGrant: (evt, gestureState) => {
                console.log('Touch start - coordinates:', evt.nativeEvent.locationX, evt.nativeEvent.locationY);
                // 롱 프레스 감지를 위해 타이머 설정
                longPressTimeoutRef.current = setTimeout(() => {
                    console.log('LONG PRESS DETECTED');
                    if (!isGestureMode) {
                        console.log('Activating voice search mode');
                        setIsGestureMode(true);
                        Speech.speak('목적지 검색 모드로 전환합니다.', { language: 'ko-KR' });
                        startListening();
                    }
                }, LONG_PRESS_DURATION);
            },
            onPanResponderMove: (evt, gestureState) => {
                if (Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5) {
                    console.log('Touch move detected - cancelling long press');
                    if (longPressTimeoutRef.current) {
                        clearTimeout(longPressTimeoutRef.current);
                        longPressTimeoutRef.current = null;
                    }
                }
            },
            onPanResponderRelease: (evt, gestureState) => {
                console.log('Touch end detected');
                if (longPressTimeoutRef.current) {
                    clearTimeout(longPressTimeoutRef.current);
                    longPressTimeoutRef.current = null;
                }
                if (Math.abs(gestureState.dx) < 5 && Math.abs(gestureState.dy) < 5) {
                    const now = Date.now();
                    const timeSinceLastTap = now - lastTapTimeRef.current;
                    console.log('Time since last tap:', timeSinceLastTap, 'ms');

                    if (timeSinceLastTap < DOUBLE_TAP_DELAY && lastTapTimeRef.current !== 0) {
                        console.log('DOUBLE TAP DETECTED');
                        if (isGestureMode) {
                            console.log('Deactivating voice search mode');
                            setIsGestureMode(false);
                            stopListening();
                            Speech.speak('일반 모드로 전환합니다.', { language: 'ko-KR' });
                        }
                        if (doubleTapTimeoutRef.current) {
                            clearTimeout(doubleTapTimeoutRef.current);
                            doubleTapTimeoutRef.current = null;
                        }
                        lastTapTimeRef.current = 0;
                    } else {
                        console.log('First tap recorded, waiting for possible second tap');
                        lastTapTimeRef.current = now;
                        if (doubleTapTimeoutRef.current) {
                            clearTimeout(doubleTapTimeoutRef.current);
                        }
                        doubleTapTimeoutRef.current = setTimeout(() => {
                            console.log('SINGLE TAP CONFIRMED');
                            if (!isGestureMode && safeDestination) {
                                console.log('Starting navigation to destination');
                                startNavigation(safeDestination);
                            }
                            lastTapTimeRef.current = 0;
                            doubleTapTimeoutRef.current = null;
                        }, DOUBLE_TAP_DELAY);
                    }
                }
            },
            onPanResponderTerminate: () => {
                console.log('Touch cancelled');
                if (longPressTimeoutRef.current) {
                    clearTimeout(longPressTimeoutRef.current);
                    longPressTimeoutRef.current = null;
                }
            },
        })
    ).current;

    const handleMapClick = (e) => {
        console.log('Map clicked', e);
        // 클릭 위치 검증
        if (e && isValidLatLng(e.latitude, e.longitude)) {
            console.log('Valid map click at:', { latitude: e.latitude, longitude: e.longitude });
        } else {
            console.warn('Invalid map click location:', e);
        }
    };

    // 컴포넌트 마운트 및 언마운트 관리
    useEffect(() => {
        console.log('MapView component mounted');
        return () => {
            console.log('MapView component unmounting, clearing timers');
            console.trace('Unmount stack trace');
            if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
            if (doubleTapTimeoutRef.current) clearTimeout(doubleTapTimeoutRef.current);
        };
    }, []);

    // 제스처 모드 변경 시 로그
    useEffect(() => {
        console.log('Gesture mode changed:', isGestureMode ? 'ON' : 'OFF');
    }, [isGestureMode]);

    // 분기점 유형에 따른 아이콘 반환 함수
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

    // 위치 정보가 준비되지 않은 경우 로딩 화면 표시
    if (!safeUserLocation) {
        return (
            <View style={styles.loadingContainer}>
                <Text>위치 정보를 불러오는 중입니다...</Text>
            </View>
        );
    }

    // 오류 발생 시 오류 화면 표시
    if (mapError) {
        return (
            <View style={styles.errorContainer}>
                <Text style={styles.errorText}>지도를 불러오는 중 오류가 발생했습니다.</Text>
                <Text style={styles.errorSubtext}>{mapError.toString()}</Text>
            </View>
        );
    }

    // 네이버 맵에 전달할 카메라 객체
    const cameraPosition = {
        latitude: safeUserLocation.latitude,
        longitude: safeUserLocation.longitude,
        zoom: 16.5,
        tilt: 45,
        bearing: 0
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
                    TRANSIT: true
                }}
            >
                {safeWalkRoute.length >= 2 && safeWalkRoute.every(coord => 
                    isValidLatLng(coord.latitude, coord.longitude)) && (
                    <NaverMapPathOverlay
                        coords={safeWalkRoute}
                        width={10}
                        color="#D4D8E3"
                        pattern={[10, 10]}
                        outlineWidth={0}
                    />
                )}
                {safeDestination && isValidLatLng(safeDestination.latitude, safeDestination.longitude) && (
                    <NaverMapMarkerOverlay
                        coordinate={safeDestination}
                        width={24}
                        height={24}
                        anchor={{ x: 0.5, y: 1 }}
                        image={require('../../assets/images/destination_icon.png')}
                        onClick={() => Speech.speak('목적지입니다.', { language: 'ko-KR' })}
                    />
                )}
                {safeInstructions.length > 0 && safeInstructions.map((instruction, index) => {
                    if (!instruction.position || !isValidLatLng(instruction.position.latitude, instruction.position.longitude)) {
                        console.warn(`Skipping invalid instruction at index ${index}`, instruction);
                        return null;
                    }
                    return (
                        <NaverMapMarkerOverlay
                            key={`instruction-${index}`}
                            coordinate={instruction.position}
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
                        backgroundColor: isGestureMode ? 'rgba(0, 0, 0, 0.05)' : 'transparent'
                    }
                ]}
                {...panResponder.panHandlers}
            />

            {/* 모드 표시 */}
            <View style={styles.modeIndicator}>
                <Text style={styles.modeText}>
                    {isGestureMode ? '음성 검색 모드' : '일반 모드'}
                </Text>
            </View>

            {/* 다음 안내 정보 표시 */}
            {nextInstruction && (
                <View style={styles.nextInstructionContainer}>
                    <Text style={styles.nextInstructionText}>{nextInstruction.description}</Text>
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
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
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
    }
});

export default MapView;