import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import MapView from './_components/MapView';
import useSpeechRecognition from './_hooks/useSpeechRecognition';
import { getPoiCoordinates, getCombinedDirections } from '../services/tmapService';
import { 
    calculateDistance, 
    generateRelativeDirectionGuidance, 
    calculateUserMovingDirection,
    getTurnInstruction 
} from '../utils/locationUtils';

const LOCATION_INTERVAL = 1000;
const INSTRUCTION_DISTANCE_THRESHOLD = 30; // 30미터 이내에서 안내
const ARRIVED_DISTANCE_THRESHOLD = 10; // 10미터 이내면 도착
const REPEAT_INSTRUCTION_DISTANCE = 50; // 50미터마다 현재 방향 반복 안내 (더 자주)
const OFF_ROUTE_THRESHOLD = 30; // 경로에서 30미터 이상 벗어나면 경고 (더 민감하게)
const DIRECTION_CHANGE_THRESHOLD = 20; // 20도 이상 방향 변화 시 안내
const CONTINUOUS_GUIDANCE_INTERVAL = 15000; // 15초마다 지속적 안내

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
    
    // 실시간 안내를 위한 새로운 상태
    const [lastAnnouncedIndex, setLastAnnouncedIndex] = useState(-1);
    const [lastDistanceAnnouncement, setLastDistanceAnnouncement] = useState(0);
    const [totalDistance, setTotalDistance] = useState(0);
    const [remainingDistance, setRemainingDistance] = useState(0);
    const [estimatedTime, setEstimatedTime] = useState(0);
    const [currentDirection, setCurrentDirection] = useState('');
    const [isOffRoute, setIsOffRoute] = useState(false);
    const [routeSummary, setRouteSummary] = useState(null);
    const [lastDirectionBearing, setLastDirectionBearing] = useState(null);
    const [lastContinuousGuidance, setLastContinuousGuidance] = useState(0);
    
    const locationSubscription = useRef(null);
    const isMounted = useRef(true);
    const lastLocationRef = useRef(null);
    const speechQueueRef = useRef([]);
    const isSpeakingRef = useRef(false);
    const locationHistoryRef = useRef([]); // 위치 히스토리 추가

    // 음성 큐 관리 (수정된 버전)
    const addToSpeechQueue = useCallback((text, priority = 'normal') => {
        console.log('🔊 음성 큐에 추가:', text, '우선순위:', priority);
        const item = { text, priority, timestamp: Date.now() };
        
        if (priority === 'urgent') {
            // 긴급한 안내는 즉시 재생하고 기존 큐를 클리어
            speechQueueRef.current = [item];
            processSpeechQueue();
        } else {
            // 일반 안내는 큐에 추가
            speechQueueRef.current.push(item);
            if (!isSpeakingRef.current) {
                processSpeechQueue();
            }
        }
    }, []);

    const processSpeechQueue = useCallback(async () => {
        if (speechQueueRef.current.length === 0 || isSpeakingRef.current) {
            return;
        }

        isSpeakingRef.current = true;
        const item = speechQueueRef.current.shift();
        
        console.log('🎤 음성 재생 시작:', item.text);

        try {
            // 기존 음성 정지
            await Speech.stop();
            
            // 짧은 지연 후 새 음성 재생
            setTimeout(() => {
                Speech.speak(item.text, {
                    language: 'ko-KR',
                    rate: 0.9, // 조금 느리게
                    pitch: 1.0,
                    onStart: () => {
                        console.log('🎤 음성 재생 실제 시작');
                    },
                    onDone: () => {
                        console.log('🎤 음성 재생 완료');
                        isSpeakingRef.current = false;
                        // 다음 큐 아이템 처리
                        setTimeout(() => processSpeechQueue(), 300);
                    },
                    onError: (error) => {
                        console.error('🎤 음성 재생 오류:', error);
                        isSpeakingRef.current = false;
                        setTimeout(() => processSpeechQueue(), 300);
                    }
                });
            }, 100);
        } catch (error) {
            console.error('음성 재생 중 오류:', error);
            isSpeakingRef.current = false;
            setTimeout(() => processSpeechQueue(), 300);
        }
    }, []);

    // 경로 상의 가장 가까운 지점 찾기
    const findNearestPointOnRoute = useCallback((currentPos, routePoints) => {
        if (!routePoints || routePoints.length === 0) return null;
        
        let minDistance = Infinity;
        let nearestPoint = null;
        let nearestIndex = -1;
        
        for (let i = 0; i < routePoints.length; i++) {
            const distance = calculateDistance(
                currentPos.latitude,
                currentPos.longitude,
                routePoints[i].latitude,
                routePoints[i].longitude
            );
            
            if (distance < minDistance) {
                minDistance = distance;
                nearestPoint = routePoints[i];
                nearestIndex = i;
            }
        }
        
        return { point: nearestPoint, distance: minDistance, index: nearestIndex };
    }, []);

    // 남은 거리 계산
    const calculateRemainingDistance = useCallback((currentPos, routePoints, nearestIndex) => {
        if (!routePoints || nearestIndex === -1) return 0;
        
        let remaining = 0;
        
        // 현재 위치에서 가장 가까운 경로 지점까지의 거리
        if (nearestIndex < routePoints.length) {
            remaining += calculateDistance(
                currentPos.latitude,
                currentPos.longitude,
                routePoints[nearestIndex].latitude,
                routePoints[nearestIndex].longitude
            );
        }
        
        // 나머지 경로 구간들의 거리
        for (let i = nearestIndex; i < routePoints.length - 1; i++) {
            remaining += calculateDistance(
                routePoints[i].latitude,
                routePoints[i].longitude,
                routePoints[i + 1].latitude,
                routePoints[i + 1].longitude
            );
        }
        
        return remaining;
    }, []);

    // 방향 안내 생성 (상대적 방향 사용)
    const generateDirectionGuidance = useCallback((currentPos, nextPos) => {
        const guidance = generateRelativeDirectionGuidance(
            currentPos, 
            nextPos, 
            locationHistoryRef.current
        );
        
        return {
            direction: guidance.direction,
            description: guidance.description,
            distance: guidance.distance,
            isAbsolute: guidance.isAbsolute || false
        };
    }, []);

    // 실시간 위치 기반 안내
    const processLocationUpdate = useCallback((currentPosition) => {
        if (!isNavigating || !route || !instructions.length) return;

        const allRoutePoints = [
            ...(route.walk || []),
            ...(route.subway || []),
            ...(route.bus || [])
        ];

        if (allRoutePoints.length === 0) return;

        // 경로 상의 가장 가까운 지점 찾기
        const nearestResult = findNearestPointOnRoute(currentPosition, allRoutePoints);
        if (!nearestResult) return;

        // 경로 이탈 확인 및 지속적 경고
        const isCurrentlyOffRoute = nearestResult.distance > OFF_ROUTE_THRESHOLD;
        if (isCurrentlyOffRoute !== isOffRoute) {
            setIsOffRoute(isCurrentlyOffRoute);
            if (isCurrentlyOffRoute) {
                addToSpeechQueue('경로에서 벗어났습니다! 경로로 돌아가세요.', 'urgent');
                
                // 경로 복귀 안내
                setTimeout(() => {
                    const routePoint = nearestResult.point;
                    if (routePoint) {
                        const backToRouteGuidance = generateDirectionGuidance(currentPosition, routePoint);
                        addToSpeechQueue(`경로로 돌아가려면 ${backToRouteGuidance.description}`, 'urgent');
                    }
                }, 2000);
            } else {
                addToSpeechQueue('경로로 복귀했습니다. 계속 진행하세요.', 'urgent');
            }
        }
        
        // 경로 이탈 중이면 지속적으로 경고 (10초마다)
        if (isCurrentlyOffRoute) {
            const now = Date.now();
            if (now - lastContinuousGuidance > 10000) {
                setLastContinuousGuidance(now);
                addToSpeechQueue(`여전히 경로에서 벗어나 있습니다. ${Math.round(nearestResult.distance)}미터 떨어져 있습니다.`, 'urgent');
            }
        }

        // 남은 거리 계산
        const remaining = calculateRemainingDistance(currentPosition, allRoutePoints, nearestResult.index);
        setRemainingDistance(remaining);

        // 예상 시간 계산 (보행 속도 4km/h 기준)
        const walkingSpeed = 4000 / 60; // 미터/분
        setEstimatedTime(Math.round(remaining / walkingSpeed));

        // 목적지 도착 확인
        if (destination) {
            const distanceToDestination = calculateDistance(
                currentPosition.latitude,
                currentPosition.longitude,
                destination.latitude,
                destination.longitude
            );

            if (distanceToDestination <= ARRIVED_DISTANCE_THRESHOLD) {
                addToSpeechQueue('목적지에 도착했습니다.', 'urgent');
                stopNavigation();
                return;
            }
        }

        // 다음 안내 지점 확인 및 상세 안내
        for (let i = currentInstructionIndex; i < instructions.length; i++) {
            const instruction = instructions[i];
            if (!instruction.position) continue;

            const distanceToInstruction = calculateDistance(
                currentPosition.latitude,
                currentPosition.longitude,
                instruction.position.latitude,
                instruction.position.longitude
            );

            // 안내 지점 근처에 도달했을 때
            if (distanceToInstruction <= INSTRUCTION_DISTANCE_THRESHOLD && i > lastAnnouncedIndex) {
                setLastAnnouncedIndex(i);
                setCurrentInstructionIndex(i);
                setNextInstruction(instruction);
                
                let announcement = '';
                
                // 안내 타입별 상세 안내
                switch (instruction.type) {
                    case 'bus':
                        announcement = `버스 정류장에 도착했습니다. ${instruction.description}`;
                        if (instruction.arrivalInfo) {
                            announcement += ` 버스는${instruction.arrivalInfo}`;
                        }
                        break;
                    case 'subway':
                        announcement = `지하철역에 도착했습니다. ${instruction.description}`;
                        break;
                    case 'walk':
                        announcement = instruction.description;
                        break;
                    case 'direction':
                        // 거리 정보가 있는 경우 더 상세히
                        if (instruction.distance && instruction.distance > 50) {
                            announcement = `${Math.round(distanceToInstruction)}미터 앞에서 ${instruction.description}`;
                        } else {
                            announcement = instruction.description;
                        }
                        break;
                    case 'crosswalk':
                        announcement = `앞에 횡단보도가 있습니다. 횡단보도를 건너세요.`;
                        break;
                    case 'stairs':
                        announcement = `앞에 계단이 있습니다. 계단을 이용하세요.`;
                        break;
                    case 'left':
                        announcement = `왼쪽으로 돌아서 이동하세요.`;
                        break;
                    case 'right':
                        announcement = `오른쪽으로 돌아서 이동하세요.`;
                        break;
                    case 'straight':
                        announcement = `직진으로 계속 이동하세요.`;
                        break;
                    default:
                        // turnType이 있는 경우 상대적 방향 안내 사용
                        if (instruction.turnType) {
                            announcement = getTurnInstruction(instruction.turnType, instruction.distance);
                        } else {
                            announcement = instruction.description || '';
                        }
                }
                
                if (announcement) {
                    addToSpeechQueue(announcement, 'normal');
                }
                break;
            }
        }

        // 현재 방향 업데이트 및 지속적 상세 안내
        if (nearestResult.index < allRoutePoints.length - 1) {
            const nextPoint = allRoutePoints[nearestResult.index + 1];
            const directionInfo = generateDirectionGuidance(currentPosition, nextPoint);
            const currentBearing = directionInfo.targetBearing || 0;
            
            setCurrentDirection(directionInfo.direction);

            // 방향 변화 감지 및 즉시 안내
            if (lastDirectionBearing !== null) {
                let bearingDiff = Math.abs(currentBearing - lastDirectionBearing);
                if (bearingDiff > 180) bearingDiff = 360 - bearingDiff;
                
                if (bearingDiff > DIRECTION_CHANGE_THRESHOLD) {
                    addToSpeechQueue(`방향이 바뀝니다. ${directionInfo.description}`, 'normal');
                    setLastDirectionBearing(currentBearing);
                }
            } else {
                setLastDirectionBearing(currentBearing);
            }

            // 거리 기반 반복 안내 (50미터마다)
            const distanceSinceLastAnnouncement = lastDistanceAnnouncement - remaining;
            if (distanceSinceLastAnnouncement >= REPEAT_INSTRUCTION_DISTANCE || lastDistanceAnnouncement === 0) {
                setLastDistanceAnnouncement(remaining);
                
                // 상대적 방향으로 더 구체적인 안내
                let detailedDirection = '';
                
                if (directionInfo.isAbsolute) {
                    // 정지 상태이거나 방향을 알 수 없는 경우
                    detailedDirection = `${directionInfo.direction} 방향으로 이동을 시작하세요.`;
                } else {
                    // 이동 중인 경우 상대적 방향 제공
                    if (directionInfo.direction === '직진') {
                        detailedDirection = '계속 직진하세요.';
                    } else {
                        detailedDirection = directionInfo.description;
                    }
                }
                
                // 남은 거리 정보
                let remainingInfo = '';
                if (remaining > 1000) {
                    remainingInfo = ` 목적지까지 약 ${(remaining/1000).toFixed(1)}킬로미터 남았습니다.`;
                } else if (remaining > 100) {
                    remainingInfo = ` 목적지까지 약 ${Math.round(remaining)}미터 남았습니다.`;
                } else {
                    remainingInfo = ` 목적지가 가까워지고 있습니다. 약 ${Math.round(remaining)}미터 남았습니다.`;
                }
                
                const fullAnnouncement = detailedDirection + remainingInfo;
                addToSpeechQueue(fullAnnouncement, 'normal');
            }
            
            // 시간 기반 지속적 안내 (15초마다)
            const now = Date.now();
            if (now - lastContinuousGuidance > CONTINUOUS_GUIDANCE_INTERVAL) {
                setLastContinuousGuidance(now);
                
                // 현재 상황에 맞는 지속적 안내
                let continuousMessage = '';
                if (directionInfo.direction === '직진') {
                    continuousMessage = '계속 직진 중입니다.';
                } else if (directionInfo.distance < 50) {
                    continuousMessage = `곧 ${directionInfo.direction}로 이동해야 합니다.`;
                } else {
                    continuousMessage = `${directionInfo.direction} 방향으로 이동 중입니다.`;
                }
                
                // 분기점이나 교차로 근처인지 확인
                const nearbyInstructions = instructions.filter(inst => {
                    if (!inst.position) return false;
                    const distToInst = calculateDistance(
                        currentPosition.latitude,
                        currentPosition.longitude,
                        inst.position.latitude,
                        inst.position.longitude
                    );
                    return distToInst <= 100; // 100미터 이내
                });
                
                if (nearbyInstructions.length > 0) {
                    const nextInst = nearbyInstructions[0];
                    if (nextInst.type === 'direction' || nextInst.type === 'left' || nextInst.type === 'right') {
                        continuousMessage += ' 분기점이 가까워지고 있습니다.';
                    } else if (nextInst.type === 'crosswalk') {
                        continuousMessage += ' 횡단보도가 가까워지고 있습니다.';
                    }
                }
                
                addToSpeechQueue(continuousMessage, 'normal');
            }
        }

        // 위치 히스토리 업데이트 (최근 10개 위치만 보관)
        locationHistoryRef.current.push({
            latitude: currentPosition.latitude,
            longitude: currentPosition.longitude,
            timestamp: Date.now()
        });
        
        if (locationHistoryRef.current.length > 10) {
            locationHistoryRef.current = locationHistoryRef.current.slice(-10);
        }
        
        lastLocationRef.current = currentPosition;
    }, [
        isNavigating, route, instructions, currentInstructionIndex, lastAnnouncedIndex,
        lastDistanceAnnouncement, isOffRoute, destination, findNearestPointOnRoute,
        calculateRemainingDistance, generateDirectionGuidance, addToSpeechQueue
    ]);

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

            // 전체 거리 계산
            const allRoutePoints = [
                ...(result.route.walk || []),
                ...(result.route.subway || []),
                ...(result.route.bus || [])
            ];
            
            let total = 0;
            for (let i = 0; i < allRoutePoints.length - 1; i++) {
                total += calculateDistance(
                    allRoutePoints[i].latitude,
                    allRoutePoints[i].longitude,
                    allRoutePoints[i + 1].latitude,
                    allRoutePoints[i + 1].longitude
                );
            }
            setTotalDistance(total);
            setRemainingDistance(total);

            // 상태 업데이트
            setRoute(result.route);
            setInstructions(result.instructions || []);
            setRouteSummary(result.summary || null);
            setNextInstruction(result.instructions && result.instructions.length > 0 ? result.instructions[0] : null);
            setCurrentInstructionIndex(0);
            setLastAnnouncedIndex(-1);
            setLastDistanceAnnouncement(0);
            setDestination(effectiveDestination);
            setIsNavigating(true);
            setIsNavigationMode(true);
            setIsOffRoute(false);

            // 경로 요약 정보 안내 (대폭 개선)
            let summaryAnnouncement = '';
            let routeDetails = [];
            
            if (result.summary) {
                const { totalDistance: summaryDistance, totalTime, totalCost, transportType } = result.summary;
                
                if (transportType === 'walk') {
                    summaryAnnouncement = `도보로 약 ${Math.round(summaryDistance)}미터, ${totalTime}분 소요됩니다.`;
                } else {
                    summaryAnnouncement = `대중교통 이용으로 총 ${totalTime}분 소요되며, 요금은 ${totalCost}원입니다.`;
                    
                    // 대중교통 경로 상세 분석
                    const busInstructions = result.instructions.filter(inst => inst.type === 'bus');
                    const subwayInstructions = result.instructions.filter(inst => inst.type === 'subway');
                    
                    if (busInstructions.length > 0) {
                        routeDetails.push('버스 이용 구간이 있습니다.');
                        busInstructions.forEach(inst => {
                            if (inst.routeName && inst.startStation && inst.endStation) {
                                routeDetails.push(`${inst.routeName} 버스를 타고 ${inst.startStation}에서 ${inst.endStation}까지 이동합니다.`);
                                if (inst.stationCount > 0) {
                                    routeDetails.push(`${inst.stationCount}개 정거장, 약 ${inst.sectionTime}분 소요됩니다.`);
                                }
                            }
                        });
                    }
                    
                    if (subwayInstructions.length > 0) {
                        routeDetails.push('지하철 이용 구간이 있습니다.');
                        subwayInstructions.forEach(inst => {
                            if (inst.routeName && inst.startStation && inst.endStation) {
                                routeDetails.push(`${inst.routeName} 지하철을 타고 ${inst.startStation}에서 ${inst.endStation}까지 이동합니다.`);
                                if (inst.stationCount > 0) {
                                    routeDetails.push(`${inst.stationCount}개 정거장, 약 ${inst.sectionTime}분 소요됩니다.`);
                                }
                            }
                        });
                    }
                    
                    // 환승 정보 확인
                    if (busInstructions.length > 1 || subwayInstructions.length > 1 || 
                        (busInstructions.length > 0 && subwayInstructions.length > 0)) {
                        routeDetails.push('환승이 필요한 경로입니다.');
                    }
                }
                
                // 대안 정보가 있는 경우
                if (result.alternativeInfo) {
                    routeDetails.push(`참고로 ${result.alternativeInfo}`);
                }
                
                if (result.fallbackReason) {
                    summaryAnnouncement = result.fallbackReason + ' ' + summaryAnnouncement;
                }
            } else {
                summaryAnnouncement = `목적지까지 약 ${Math.round(total)}미터입니다. 예상 시간은 약 ${Math.round(total / (4000/60))}분입니다.`;
            }
            
            // 첫 번째 안내: 기본 요약
            addToSpeechQueue(summaryAnnouncement + ' 경로 안내를 시작합니다.', 'normal');
            
            // 두 번째 안내: 상세 경로 정보 (3초 후)
            if (routeDetails.length > 0) {
                setTimeout(() => {
                    const detailsAnnouncement = routeDetails.join(' ');
                    addToSpeechQueue(detailsAnnouncement, 'normal');
                }, 3000);
            }
            
            // 세 번째 안내: 첫 번째 실제 행동 안내 (6초 후)
            if (result.instructions && result.instructions.length > 1) {
                const firstInstruction = result.instructions[1]; // 0번은 출발지이므로 1번부터
                if (firstInstruction && firstInstruction.description) {
                    setTimeout(() => {
                        addToSpeechQueue(`첫 번째 안내: ${firstInstruction.description}`, 'normal');
                    }, 6000);
                }
            }
            
            return true;
        } catch (error) {
            console.error('내비게이션 시작 오류:', error);
            Alert.alert('내비게이션 오류', error.message || '경로를 찾을 수 없습니다.');
            return false;
        }
    }, [userLocation, addToSpeechQueue]);

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
            addToSpeechQueue('목적지를 찾을 수 없습니다. 다시 시도해주세요.', 'urgent');
            return false;
        }
    }, [userLocation, startNavigation, addToSpeechQueue]);

    // 내비게이션 종료 함수
    const stopNavigation = useCallback(() => {
        console.log('내비게이션 종료');
        addToSpeechQueue('경로 안내를 종료합니다.', 'urgent');
        
        setIsNavigating(false);
        setIsNavigationMode(false);
        setRoute(null);
        setInstructions([]);
        setRouteSummary(null);
        setDestination(null);
        setCurrentInstructionIndex(0);
        setLastAnnouncedIndex(-1);
        setLastDistanceAnnouncement(0);
        setNextInstruction(null);
        setTotalDistance(0);
        setRemainingDistance(0);
        setEstimatedTime(0);
        setCurrentDirection('');
        setIsOffRoute(false);
        setLastDirectionBearing(null);
        setLastContinuousGuidance(0);
        
        // 음성 큐 및 위치 히스토리 초기화
        speechQueueRef.current = [];
        isSpeakingRef.current = false;
        locationHistoryRef.current = [];
    }, [addToSpeechQueue]);

    // 음성 인식 훅
    const { 
        recognizedText,
        transcript,
        isFinal,
        isListening,
        startListening, 
        stopListening 
    } = useSpeechRecognition({
        userLocation
    });

    // 위치 설정 및 실시간 추적
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
                
                // 위치 추적 - 내비게이션 중일 때 더 자주 업데이트
                locationSubscription.current = await Location.watchPositionAsync(
                    {
                        accuracy: Location.Accuracy.Highest,
                        distanceInterval: isNavigating ? 3 : 10, // 내비게이션 중 3미터마다 업데이트
                        timeInterval: isNavigating ? 500 : LOCATION_INTERVAL // 내비게이션 중 0.5초마다 업데이트
                    },
                    (location) => {
                        if (isActive && isMounted.current) {
                            const { latitude, longitude } = location.coords;
                            const newLocation = { latitude, longitude };
                            setUserLocation(newLocation);
                            
                            // 위치 히스토리에 추가 (내비게이션 중이 아닐 때도)
                            locationHistoryRef.current.push({
                                latitude,
                                longitude,
                                timestamp: Date.now()
                            });
                            
                            if (locationHistoryRef.current.length > 10) {
                                locationHistoryRef.current = locationHistoryRef.current.slice(-10);
                            }
                            
                            if (isNavigating) {
                                processLocationUpdate(newLocation);
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
    }, [isNavigating, processLocationUpdate]);

    // 시작 메시지
    useEffect(() => {
        if (userLocation && !initialMessageShown && !isNavigating) {
            const timer = setTimeout(() => {
                console.log('🔊 시작 메시지 재생 시도');
                addToSpeechQueue('화면을 길게 누르면 음성인식 모드가 실행됩니다.', 'normal');
                setInitialMessageShown(true);
            }, 2000);
            
            return () => clearTimeout(timer);
        }
    }, [userLocation, initialMessageShown, isNavigating, addToSpeechQueue]);

    // 음성 테스트 함수 (개발용)
    const testSpeech = useCallback(() => {
        console.log('🔊 음성 테스트 시작');
        Speech.speak('음성 테스트입니다. 소리가 들리나요?', {
            language: 'ko-KR',
            rate: 0.9,
            onStart: () => console.log('🎤 테스트 음성 시작'),
            onDone: () => console.log('🎤 테스트 음성 완료'),
            onError: (error) => console.error('🎤 테스트 음성 오류:', error)
        });
    }, []);

    // 컴포넌트 언마운트
    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
            speechQueueRef.current = [];
            isSpeakingRef.current = false;
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
                    // 추가 정보 전달
                    remainingDistance={remainingDistance}
                    estimatedTime={estimatedTime}
                    currentDirection={currentDirection}
                    isOffRoute={isOffRoute}
                    routeSummary={routeSummary}
                    testSpeech={testSpeech}
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