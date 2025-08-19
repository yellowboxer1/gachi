import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import MapView from './_components/MapView';
import useSpeechRecognition from './_hooks/useSpeechRecognition';
import { getPoiCoordinates, getCombinedDirections } from '../services/tmapService';
import { calculateDistance } from '../utils/locationUtils';

const LOCATION_INTERVAL = 1000;

export default function MainScreen() {
    // 상태 관리
    const [userLocation, setUserLocation] = useState(null);
    const [destination, setDestination] = useState(null);
    const [route, setRoute] = useState(null);
    const [initialMessageShown, setInitialMessageShown] = useState(false);
    const [instructions, setInstructions] = useState([]);
    const [nextInstruction, setNextInstruction] = useState(null);
    const [currentInstructionIndex, setCurrentInstructionIndex] = useState(0);
    const [isNavigating, setIsNavigating] = useState(false);
    const [isSpeechModalVisible, setIsSpeechModalVisible] = useState(false);
    const [isNavigationMode, setIsNavigationMode] = useState(false);
    
    const locationSubscription = useRef(null);
    const isMounted = useRef(true);

    // 내비게이션 시작 함수
    const startNavigation = useCallback(async (effectiveDestination) => {
        try {
            console.log('startNavigation 호출됨:', effectiveDestination);
            
            if (!userLocation) {
                throw new Error('현재 위치를 알 수 없습니다.');
            }

            if (!effectiveDestination || !effectiveDestination.latitude || !effectiveDestination.longitude) {
                throw new Error('목적지 정보가 올바르지 않습니다.');
            }

            console.log('경로 탐색 시작 - 출발:', userLocation, '도착:', effectiveDestination);
            
            const result = await getCombinedDirections(userLocation, effectiveDestination);
            
            if (!result || !result.route) {
                throw new Error('경로를 찾을 수 없습니다.');
            }

            console.log('경로 탐색 성공:', result);

            // 상태 업데이트
            setRoute(result.route);
            setInstructions(result.instructions || []);
            setNextInstruction(result.instructions && result.instructions.length > 0 ? result.instructions[0] : null);
            setCurrentInstructionIndex(0);
            setDestination(effectiveDestination);
            setIsNavigating(true);
            setIsNavigationMode(true);

            Speech.speak('경로 안내를 시작합니다.', { language: 'ko-KR' });
            return true;
        } catch (error) {
            console.error('내비게이션 시작 오류:', error);
            Alert.alert('내비게이션 오류', error.message || '경로를 찾을 수 없습니다.');
            return false;
        }
    }, [userLocation]);

    // 목적지 검색 함수
    const searchDestination = useCallback(async (query, coordinates = null) => {
        try {
            console.log('searchDestination 호출됨 - query:', query, 'coordinates:', coordinates);
            
            let finalCoordinates = coordinates;
            
            if (!finalCoordinates) {
                const poiDataList = await getPoiCoordinates(query, userLocation);
                if (!poiDataList || poiDataList.length === 0) {
                    throw new Error('목적지를 찾을 수 없습니다.');
                }
                finalCoordinates = {
                    latitude: poiDataList[0].latitude,
                    longitude: poiDataList[0].longitude
                };
            }
            
            console.log('목적지 좌표:', finalCoordinates);
            setDestination(finalCoordinates);
            
            // 내비게이션 시작
            const success = await startNavigation(finalCoordinates);
            return success;
        } catch (error) {
            console.error('목적지 검색 오류:', error);
            Speech.speak('목적지를 찾을 수 없습니다. 다시 시도해주세요.', { language: 'ko-KR' });
            return false;
        }
    }, [userLocation, startNavigation]);

    // 내비게이션 종료 함수
    const stopNavigation = useCallback(() => {
        console.log('내비게이션 종료');
        Speech.speak('경로 안내를 종료합니다.', { language: 'ko-KR' });
        setIsNavigating(false);
        setIsNavigationMode(false);
        setRoute(null);
        setInstructions([]);
        setDestination(null);
        setCurrentInstructionIndex(0);
        setNextInstruction(null);
    }, []);

    // 음성 인식 훅 - 의존성 배열 수정
    const { 
        recognizedText,
        transcript,
        isFinal,
        isListening,
        startListening, 
        stopListening 
    } = useSpeechRecognition({
        setRoute,
        setDestination,
        setIsSpeechModalVisible,
        userLocation,
        startNavigation
    });

    // 다음 안내 확인 함수
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
        
        const nextInst = instructions[nextIdx];
        if (!nextInst || !nextInst.position) return;
        
        const distance = calculateDistance(
            currentPosition.latitude,
            currentPosition.longitude,
            nextInst.position.latitude,
            nextInst.position.longitude
        );
        
        if (distance <= 20) {
            setNextInstruction(nextInst);
            setCurrentInstructionIndex(nextIdx);
            if (nextInst.description) {
                Speech.speak(nextInst.description, { language: 'ko-KR' });
            }
        }
    }, [instructions, currentInstructionIndex, stopNavigation]);

    // 위치 설정
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
                
                // 위치 추적
                locationSubscription.current = await Location.watchPositionAsync(
                    {
                        accuracy: Location.Accuracy.Highest,
                        distanceInterval: 5,
                        timeInterval: LOCATION_INTERVAL
                    },
                    (location) => {
                        if (isActive && isMounted.current) {
                            const { latitude, longitude } = location.coords;
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
        
        setupLocation();
        
        return () => {
            isActive = false;
            if (locationSubscription.current) {
                locationSubscription.current.remove();
            }
        };
    }, [isNavigating, checkNextInstruction]);

    // 시작 메시지
    useEffect(() => {
        if (userLocation && !initialMessageShown && !isNavigating) {
            const timer = setTimeout(() => {
                Speech.speak('화면을 길게 누르면 음성인식 모드가 실행됩니다.', { language: 'ko-KR' });
                setInitialMessageShown(true);
            }, 2000);
            
            return () => clearTimeout(timer);
        }
    }, [userLocation, initialMessageShown, isNavigating]);

    // 컴포넌트 언마운트
    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    return (
        <View style={styles.container}>
            {userLocation && (
                <MapView
                    userLocation={userLocation}
                    destination={destination}
                    route={route}
                    instructions={instructions}
                    nextInstruction={nextInstruction}
                    startListening={startListening}
                    stopListening={stopListening}
                    startNavigation={startNavigation}
                    stopNavigation={stopNavigation}
                    searchDestination={searchDestination}
                    isNavigationMode={isNavigationMode}
                    setIsNavigationMode={setIsNavigationMode}
                    recognizedText={recognizedText}
                    isListening={isListening}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
});