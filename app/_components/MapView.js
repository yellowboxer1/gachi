import React, { useEffect, useState, useRef } from 'react';
import { NaverMapView, NaverMapPathOverlay } from '@mj-studio/react-native-naver-map';
import { StyleSheet, View, Text } from 'react-native';
import * as Speech from 'expo-speech';
import { isValidLatLng } from '../../utils/locationUtils';

const MapView = ({ userLocation, destination, route, setRoute, setIsSpeechModalVisible, startListening, stopListening, startNavigation }) => {
    const [isGestureMode, setIsGestureMode] = useState(false);
    const tapCount = useRef(0);
    const lastTapTime = useRef(0);
    const tapTimer = useRef(null);

    const handleMapClick = (e) => {
        const currentTime = Date.now();
        const timeSinceLastTap = currentTime - lastTapTime.current;

        tapCount.current += 1;

        if (tapCount.current === 1) {
            tapTimer.current = setTimeout(() => {
                console.log('Single tap detected');
                if (!isGestureMode && destination) {
                    startNavigation(destination);
                }
                tapCount.current = 0;
            }, 300); // 300ms 후 단일 탭 확정
        } else if (tapCount.current === 2 && timeSinceLastTap < 300) {
            clearTimeout(tapTimer.current);
            console.log('Double tap detected');
            if (!isGestureMode) {
                setIsGestureMode(true);
                setIsSpeechModalVisible(true);
                Speech.speak('목적지 검색 모드로 전환합니다. 목적지 이름을 말씀해주세요.', { language: 'ko-KR' });
                startListening();
            } else {
                setIsGestureMode(false);
                setIsSpeechModalVisible(false);
                stopListening();
                Speech.speak('일반 모드로 전환합니다.', { language: 'ko-KR' });
            }
            tapCount.current = 0;
        }

        lastTapTime.current = currentTime;
    };

    useEffect(() => {
        return () => {
            clearTimeout(tapTimer.current);
        };
    }, []);

    return userLocation && isValidLatLng(userLocation) ? (
        <View style={styles.mapContainer}>
            <NaverMapView
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
                onMapClick={handleMapClick} // 더블 탭으로 음성 인식
                scrollGesturesEnabled={true}
                zoomGesturesEnabled={true}
                tiltGesturesEnabled={true}
                rotateGesturesEnabled={true}
            >
                {route?.walk?.length >= 2 && (
                    <NaverMapViewPathOverlay
                        coords={route.walk}
                        width={5}
                        color="#808080"
                        pattern={[10, 10]}
                        outlineWidth={0}
                    />
                )}
                {route?.subway?.length >= 2 && (
                    <NaverMapViewPathOverlay
                        coords={route.subway}
                        width={5}
                        color="#F06A00"
                        outlineWidth={2}
                        outlineColor="#FFFFFF"
                    />
                )}
                {route?.bus?.length >= 2 && (
                    <NaverMapViewPathOverlay
                        coords={route.bus}
                        width={5}
                        color="#FF0000"
                        outlineWidth={2}
                        outlineColor="#FFFFFF"
                    />
                )}
            </NaverMapView>

            {/* 모드 표시 */}
            <View style={styles.modeIndicator}>
                <Text style={styles.modeText}>
                    {isGestureMode ? '음성 검색 모드' : '일반 모드'}
                </Text>
            </View>
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
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    modeIndicator: {
        position: 'absolute',
        top: 20,
        alignSelf: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        paddingVertical: 8,
        paddingHorizontal: 15,
        borderRadius: 20,
    },
    modeText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 14,
    },
});

export default MapView;