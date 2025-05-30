import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Alert, Text } from 'react-native';
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
    const [initialMessageShown, setInitialMessageShown] = useState(false);
    const [instructions, setInstructions] = useState([]);
    const [nextInstruction, setNextInstruction] = useState(null);
    const [currentInstructionIndex, setCurrentInstructionIndex] = useState(0);
    const [isNavigating, setIsNavigating] = useState(false);
    const [isSpeechModalVisible, setIsSpeechModalVisible] = useState(false);
    const [isMounted, setIsMounted] = useState(false); // 마운트 상태 관리
    const [speechResultCallback, setSpeechResultCallback] = useState(null); // 음성 인식 결과 콜백 함수
    const [isConfirmMode, setIsConfirmMode] = useState(false); // 추가: 확인 모드 상태
    const [isNavigationMode, setIsNavigationMode] = useState(false); // 추가: 경로 안내 모드
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
            setIsNavigationMode(true); // 추가: 경로 안내 모드 활성화
    
            Speech.speak('경로 안내를 시작합니다.', { language: 'ko-KR' });
            return true;
        } catch (error) {
            console.error('내비게이션 시작 오류:', error);
            Alert.alert('내비게이션 오류', error.message || '경로를 찾을 수 없습니다.');
            return false;
        }
    }, [userLocation]);
    // 음성 인식 결과 핸들러
    const handleSpeechResult = useCallback((callback) => {
        setSpeechResultCallback(() => callback);
    }, []);
    // 음성 인식 훅
    const { 
        recognizedText,
        startListening, 
        stopListening 
    } = useSpeechRecognition({
        setRoute,
        setDestination,
        setIsSpeechModalVisible,
        userLocation,
        startNavigation
    });
    // 음성 검색 모드 종료 함수
    const stopSpeechMode = () => {
        setIsConfirmMode(false);
        stopListening();
    };
    // 목적지 검색 함수 (확인 모드 종료, 경로 안내 모드 진입)
    const searchDestination = async (query) => {
        try {
          const poiDataList = await getPoiCoordinates(query, userLocation);
          if (!poiDataList || poiDataList.length === 0) throw new Error('목적지 없음');
          
          // 첫 번째 POI에서 좌표 정보만 추출
          const coordinates = {
            latitude: poiDataList[0].latitude,
            longitude: poiDataList[0].longitude
          };
          
          setDestination(coordinates);
          console.log('목적지 설정 완료:', coordinates);
          
          await startNavigation(coordinates);
          stopSpeechMode(); // 음성 검색 모드 종료
          setIsNavigationMode(true); // 경로 안내 모드 진입
        } catch (error) {
          console.error('검색 오류:', error);
          Alert.alert('검색 오류', '목적지를 찾을 수 없습니다.');
        }
      };
    // 내비게이션 종료 함수 (MapView로 이동)
    const stopNavigation = useCallback(() => {
        Speech.speak('경로 안내를 종료합니다.', { language: 'ko-KR' });
        setIsNavigating(false);
        setIsNavigationMode(false);
        setRoute(null);
        setInstructions([]);
        setDestination(null);
        setCurrentInstructionIndex(0);
        setNextInstruction(null);
      }, []);
    // 음성 인식 결과가 나오면 MapView로 전달
    useEffect(() => {
        if (recognizedText && speechResultCallback) {
            console.log('음성 인식 결과 콜백 호출:', recognizedText);
            speechResultCallback(recognizedText);
        }
    }, [recognizedText, speechResultCallback]);
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
    }, [isNavigating]);
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
                    // stopNavigation(); // MapView에서 처리
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
    }, [instructions, currentInstructionIndex]); // stopNavigation 제거
    // 시작 메시지 재생
    useEffect(() => {
        if (isMounted && userLocation && !initialMessageShown && !isNavigating) {
          const initialMessageTimer = setTimeout(() => {
            Speech.speak('화면을 길게 누르면 음성인식 모드가 실행됩니다.', { language: 'ko-KR' });
            setInitialMessageShown(true);
          }, 2000);
          
          return () => clearTimeout(initialMessageTimer);
        }
      }, [isMounted, userLocation, initialMessageShown, isNavigating]);
      return (
        <View style={styles.container}>
          {userLocation && isMounted && (
            <MapView
              userLocation={userLocation}
              destination={destination}
              route={route}
              instructions={instructions}
              nextInstruction={nextInstruction}
              startListening={startListening}
              stopListening={stopListening}
              startNavigation={startNavigation}
              stopNavigation={stopNavigation} // 추가: 내비게이션 종료 함수 전달
              onSpeechResult={handleSpeechResult}
              searchDestination={searchDestination}
              isConfirmMode={isConfirmMode}
              setIsConfirmMode={setIsConfirmMode}
              isNavigationMode={isNavigationMode}
              setIsNavigating={setIsNavigating}
              setRoute={setRoute}
              setInstructions={setInstructions}
              setDestination={setDestination}
              setCurrentInstructionIndex={setCurrentInstructionIndex}
              setNextInstruction={setNextInstruction}
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