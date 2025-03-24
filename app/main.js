import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Alert, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import MapView from './_components/MapView';
import useSpeechRecognition from './_hooks/useSpeechRecognition';
import { getPoiCoordinates, getCombinedDirections } from '../services/tmapService';
import { calculateDistance, DEFAULT_LOCATION } from '../utils/locationUtils';

const LOCATION_INTERVAL = 1000; // 위치 업데이트 간격 (밀리초)

export default function MainScreen() {
    // 상태 관리
    const [userLocation, setUserLocation] = useState(null);
    const [destination, setDestination] = useState(null);
    const [route, setRoute] = useState(null);
    const [instructions, setInstructions] = useState([]);
    const [nextInstruction, setNextInstruction] = useState(null);
    const [currentInstructionIndex, setCurrentInstructionIndex] = useState(0);
    const [isNavigating, setIsNavigating] = useState(false);
    const [isSpeechModalVisible, setIsSpeechModalVisible] = useState(false);
    const [isMounted, setIsMounted] = useState(false); // 마운트 상태 관리

    const locationSubscription = useRef(null);

    // 내비게이션 시작 함수 (useCallback으로 메모이제이션)
    const startNavigation = useCallback(async (effectiveDestination) => {
        try {
            if (!userLocation) {
                throw new Error('현재 위치를 알 수 없습니다.');
            }
    
            const navigateParams = { effectiveDestination, userLocation };
            console.log('Starting navigation with:', navigateParams);
    
            const result = await getCombinedDirections(userLocation, effectiveDestination);
            if (!result || !result.route) {
                throw new Error('경로를 찾을 수 없습니다.');
            }
    
            console.log('대중교통 경로 조회 성공:',
                Object.keys(result.route)
                    .filter(key => Array.isArray(result.route[key]) && result.route[key].length > 0)
                    .map(key => `${key} ${result.route[key].length} 좌표`)
                    .join(', '),
                result.instructions ? `, ${result.instructions.length} 안내` : ''
            );
    
            // 상태 업데이트를 한 번에 처리
            setRoute(() => result.route);
            setInstructions(() => result.instructions || []);
            setNextInstruction(() => result.instructions && result.instructions.length > 0 ? result.instructions[0] : null);
            setCurrentInstructionIndex(() => 0);
            setDestination(() => effectiveDestination);
            setIsNavigating(() => true);
    
            Speech.speak('경로 안내를 시작합니다.', { language: 'ko-KR' });
            return true;
        } catch (error) {
            console.error('내비게이션 시작 오류:', error);
            Alert.alert('내비게이션 오류', error.message || '경로를 찾을 수 없습니다.');
            return false;
        }
    }, [userLocation]);

    // 위치 및 음성 인식 (startNavigation 전달 확인)
    const { 
        recognizedText,
        results,
        partialResults,
        started,
        end,
        error,
        startListening, 
        stopListening
    } = useSpeechRecognition({
        setRoute,
        setDestination,
        setIsSpeechModalVisible,
        userLocation,
        startNavigation // startNavigation 명시적으로 전달
    });

    // 마운트 상태 설정
    useEffect(() => {
        let isActive = true;
    
        const setupLocation = async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                console.log('위치 권한 상태:', status);
                if (status !== 'granted') {
                    Alert.alert(
                        '위치 권한 필요',
                        '이 앱은 사용자의 위치를 사용하여 내비게이션 서비스를 제공합니다.',
                        [{ text: '확인' }]
                    );
                    return;
                }
                
                const currentLocation = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Highest
                });
                
                const { latitude, longitude } = currentLocation.coords;
                if (isActive) {
                    console.log('받아온 위치 정보:', currentLocation.coords);
                    setUserLocation({ latitude, longitude });
                }
                
                locationSubscription.current = await Location.watchPositionAsync(
                    {
                        accuracy: Location.Accuracy.Highest,
                        distanceInterval: 5,
                        timeInterval: LOCATION_INTERVAL
                    },
                    (location) => {
                        const { latitude, longitude } = location.coords;
                        if (isActive) {
                            setUserLocation({ latitude, longitude });
                            if (isNavigating) {
                                checkNextInstruction({ latitude, longitude });
                            }
                        }
                    }
                );
            } catch (error) {
                console.error('위치 설정 오류:', error);
                Alert.alert('위치 오류', '위치 정보를 가져올 수 없습니다.');
            }
        };
        
        setIsMounted(true);
        setupLocation();
        
        return () => {
            isActive = false;
            setIsMounted(false);
            if (locationSubscription.current) {
                locationSubscription.current.remove();
            }
        };
    }, [isNavigating, checkNextInstruction]);
    // 목적지 검색 함수
    const searchDestination = async (query) => {
        try {
            const coordinates = await getPoiCoordinates(query, userLocation);
            if (coordinates) {
                setDestination(coordinates);
                console.log('목적지 설정 완료:', coordinates);
                await startNavigation(coordinates); // 검색 후 바로 내비게이션 시작
            }
        } catch (error) {
            console.error('목적지 검색 오류:', error);
            Alert.alert('목적지 검색 오류', '목적지를 찾을 수 없습니다.');
        }
    };
    
    // 내비게이션 종료 함수
    const stopNavigation = useCallback(() => {
        setRoute(null);
        setInstructions([]);
        setNextInstruction(null);
        setCurrentInstructionIndex(0);
        setIsNavigating(false);
        Speech.speak('경로 안내를 종료합니다.', { language: 'ko-KR' });
    }, []);

    // 다음 안내 확인 함수 (useCallback으로 메모이제이션)
    const checkNextInstruction = useCallback((currentPosition) => {
        if (!instructions || instructions.length === 0 || currentInstructionIndex >= instructions.length) {
            return;
        }
        
        const currentInstruction = instructions[currentInstructionIndex];
        const nextIdx = currentInstructionIndex + 1;
        
        if (nextIdx >= instructions.length) {
            if (currentInstruction.type === 'destination') {
                const distance = calculateDistance(
                    currentPosition.latitude, 
                    currentPosition.longitude,
                    currentInstruction.position.latitude,
                    currentInstruction.position.longitude
                );
                
                if (distance <= 10) {
                    Alert.alert('도착', '목적지에 도착했습니다.');
                    stopNavigation();
                }
            }
            return;
        }
        
        const nextInstruction = instructions[nextIdx];
        const distance = calculateDistance(
            currentPosition.latitude,
            currentPosition.longitude,
            nextInstruction.position.latitude,
            nextInstruction.position.longitude
        );
        
        if (distance <= 20) {
            setNextInstruction(nextInstruction);
            setCurrentInstructionIndex(nextIdx);
            if (nextInstruction.description) {
                Speech.speak(nextInstruction.description, { language: 'ko-KR' });
            }
        }
    }, [instructions, currentInstructionIndex, stopNavigation]);


    return (
        <View style={styles.container}>
            {(!userLocation || !isMounted) && (
                <View style={styles.loadingContainer}>
                    <Text>로딩 중...</Text>
                </View>
            )}
            {userLocation && isMounted && (
                <MapView
                    userLocation={userLocation}
                    destination={destination}
                    route={route}
                    instructions={instructions}
                    nextInstruction={nextInstruction}
                    setRoute={setRoute}
                    startListening={startListening}
                    stopListening={stopListening}
                    startNavigation={startNavigation}
                />
            )}
            {isNavigating && (
                <TouchableOpacity 
                    style={styles.stopButton}
                    onPress={() => {
                        Alert.alert(
                            '내비게이션 종료',
                            '내비게이션을 종료하시겠습니까?',
                            [
                                { text: '아니오', style: 'cancel' },
                                { text: '예', onPress: stopNavigation }
                            ]
                        );
                    }}
                >
                    <Text style={styles.stopButtonText}>종료</Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    stopButton: {
        position: 'absolute',
        bottom: 30,
        right: 20,
        backgroundColor: 'red',
        padding: 15,
        borderRadius: 30,
        elevation: 5,
    },
    stopButtonText: {
        color: 'white',
        fontWeight: 'bold',
    },
});
