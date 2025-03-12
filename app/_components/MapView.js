import React, { useEffect, useState, useRef } from 'react';
import { NaverMapView, NaverMapPathOverlay } from '@mj-studio/react-native-naver-map';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import * as Speech from 'expo-speech';
import { getTransitDirections, getPedestrianDirections } from '../../services/naverMapService';
import { isValidLatLng } from '../../utils/locationUtils';

const MapView = ({ userLocation, destination, route, setRoute, setIsSpeechModalVisible, startListening, stopListening }) => {
    const [tapCount, setTapCount] = useState(0);
    const tapTimer = useRef(null);
    const pressTimer = useRef(null);
    const mapRef = useRef(null);

    const handleLongPress = async () => {
        console.log('Long press detected');
        setIsSpeechModalVisible(true);
        Speech.speak('목적지 검색 모드로 전환합니다. 목적지 이름을 말씀해주세요.', { language: 'ko-KR' });
        await startListening();
    };

    useEffect(() => {
        if (tapCount === 1) {
            tapTimer.current = setTimeout(() => {
                console.log('Single tap detected, resetting tap count');
                setTapCount(0);
            }, 300); // 더블 탭 감지 시간을 300ms로 조정
        } else if (tapCount === 2) {
            clearTimeout(tapTimer.current);
            console.log('Double tap detected');
            setTapCount(0);
            setIsSpeechModalVisible(false);
            stopListening();
        }
        return () => clearTimeout(tapTimer.current);
    }, [tapCount]);

    const handleTap = () => {
        setTapCount(prev => prev + 1);
    };

    const handleTouchStart = () => {
        pressTimer.current = setTimeout(() => {
            handleLongPress();
        }, 500);
    };

    const handleTouchEnd = () => {
        if (pressTimer.current) {
            clearTimeout(pressTimer.current);
        }
    };

    const startNavigation = async () => {
        try {
            console.log('User Location:', userLocation);
            console.log('Destination:', destination);

            if (!userLocation || !destination) {
                Speech.speak('위치 또는 목적지가 설정되지 않았습니다.', { language: 'ko-KR' });
                console.error('위치 또는 목적지가 설정되지 않았습니다.');
                return;
            }

            if (!isValidLatLng(userLocation) || !isValidLatLng(destination)) {
                Speech.speak('유효하지 않은 위치 또는 목적지입니다.', { language: 'ko-KR' });
                console.error('유효하지 않은 위치 또는 목적지입니다.');
                return;
            }

            Speech.speak('내비게이션을 시작합니다.', { language: 'ko-KR' });

            let formattedRouteStructured = { walk: [], subway: [], bus: [] };
            try {
                const { formattedRoute, navigationInstructions } = await getTransitDirections(userLocation, destination);

                let currentMode = 'walk';
                let currentSegment = [];
                formattedRoute.forEach((coord, index) => {
                    const instruction = navigationInstructions.find(inst => 
                        inst.position.latitude === coord.latitude && inst.position.longitude === coord.longitude
                    );

                    if (instruction) {
                        if (currentSegment.length > 0) {
                            formattedRouteStructured[currentMode].push(...currentSegment);
                            currentSegment = [];
                        }
                        currentMode = instruction.type;
                    }
                    currentSegment.push(coord);

                    if (index === formattedRoute.length - 1 && currentSegment.length > 0) {
                        formattedRouteStructured[currentMode].push(...currentSegment);
                    }
                });
                console.log('대중교통 경로 성공 - Formatted route:', formattedRouteStructured);
            } catch (transitError) {
                console.warn('대중교통 경로 가져오기 실패, 보행자 경로로 전환:', transitError.message);
                const { formattedRoute, navigationInstructions } = await getPedestrianDirections(userLocation, destination);

                formattedRouteStructured.walk = formattedRoute;
                navigationInstructions.forEach(instruction => {
                    if (instruction.type === 'crosswalk') {
                        formattedRouteStructured.walk.push(instruction.position);
                    }
                });
                console.log('보행자 경로 성공 - Formatted route:', formattedRouteStructured);
            }

            setRoute(formattedRouteStructured);

            if (mapRef.current) {
                mapRef.current.animateToCoordinate({
                    latitude: userLocation.latitude,
                    longitude: userLocation.longitude,
                });
            }
        } catch (error) {
            console.error('내비게이션 시작 오류:', error);
            Speech.speak('내비게이션을 시작하는 데 문제가 발생했습니다.', { language: 'ko-KR' });
        }
    };

    return userLocation ? (
        <View style={styles.mapContainer}>
            <NaverMapView
                ref={mapRef}
                style={styles.map}
                camera={{
                    latitude: userLocation.latitude,
                    longitude: userLocation.longitude,
                    zoom: 16.5,
                    tilt: 45,
                    bearing: 0,
                }}
                buildingHeight={0.75}
                symbolScale={1.2}
                buildingLayer={true}
                showsLocationButton={true}
                scaleBar={false}
                locationTrackingMode="Follow"
                onTapMap={(event) => {
                    console.log('Map tapped:', event);
                    startNavigation(); // 지도 탭 시 내비게이션 시작
                }}
            >
                {route?.walk?.length >= 2 && (
                    <NaverMapPathOverlay
                        coords={route.walk}
                        width={5}
                        color="#808080"
                        pattern={[10, 10]}
                        outlineWidth={0}
                    />
                )}
                {route?.subway?.length >= 2 && (
                    <NaverMapPathOverlay
                        coords={route.subway}
                        width={5}
                        color="#F06A00"
                        outlineWidth={2}
                        outlineColor="#FFFFFF"
                    />
                )}
                {route?.bus?.length >= 2 && (
                    <NaverMapPathOverlay
                        coords={route.bus}
                        width={5}
                        color="#FF0000"
                        outlineWidth={2}
                        outlineColor="#FFFFFF"
                    />
                )}
            </NaverMapView>
            <TouchableOpacity
                style={styles.overlay}
                onPressIn={handleTouchStart}
                onPressOut={handleTouchEnd}
                onPress={handleTap}
                activeOpacity={1}
                // 지도 이동을 허용하기 위해 pointerEvents 조정
                pointerEvents="box-none"
            />
        </View>
    ) : (
        <View style={styles.loadingContainer}>
            <Text>위치 정보를 불러오는 중입니다...</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    mapContainer: {
        flex: 1,
        width: '100%',
    },
    map: {
        flex: 1,
        width: '100%',
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'transparent',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
});

export default MapView;