import axios from 'axios';
import { TMAP_APP_KEY } from '@env';
import { calculateDistance, isValidLatLng, calculateBearing, getDirectionFromBearing } from '../utils/locationUtils';

// POI 검색 (장소 검색)
export const getPoiCoordinates = async (query, userLocation = null) => {
    try {
        if (!TMAP_APP_KEY) {
            throw new Error('TMAP_APP_KEY가 설정되지 않았습니다.');
        }

        const params = {
            version: 1,
            searchKeyword: query,
            appKey: TMAP_APP_KEY,
            count: 3,
        };

        if (userLocation && isValidLatLng(userLocation)) {
            params.centerLat = userLocation.latitude;
            params.centerLon = userLocation.longitude;
            params.radius = 5; // 5km 반경
            params.searchtypCd = 'R'; // 반경 검색
        }

        const response = await axios.get('https://apis.openapi.sk.com/tmap/pois', {
            params,
            timeout: 5000,
        });

        const pois = response.data.searchPoiInfo?.pois?.poi;
        if (!pois || !Array.isArray(pois) || pois.length === 0) {
            return [];
        }

        const poiList = pois.map(poi => {
            const latitude = parseFloat(poi.frontLat);
            const longitude = parseFloat(poi.frontLon);

            if (isNaN(latitude) || isNaN(longitude)) {
                return null;
            }

            return {
                latitude,
                longitude,
                name: poi.name || query,
                upperAddrName: poi.upperAddrName || '',
                middleAddrName: poi.middleAddrName || '',
                lowerAddrName: poi.lowerAddrName || '',
                firstNo: poi.firstNo || '',
                secondNo: poi.secondNo || '',
                fullAddress: `${poi.upperAddrName || ''} ${poi.middleAddrName || ''} ${poi.lowerAddrName || ''}`.trim(),
            };
        }).filter(poi => poi !== null);

        // 사용자 위치 기반 거리순 정렬
        if (userLocation && isValidLatLng(userLocation)) {
            poiList.sort((a, b) => {
                const distA = calculateDistance(
                    userLocation.latitude,
                    userLocation.longitude,
                    a.latitude,
                    a.longitude
                );
                const distB = calculateDistance(
                    userLocation.latitude,
                    userLocation.longitude,
                    b.latitude,
                    b.longitude
                );
                return distA - distB;
            });
        }

        return poiList;
    } catch (error) {
        console.error('POI 검색 오류:', error.message);
        return [];
    }
};

// 상세한 보행자 안내 생성
const generateDetailedWalkInstructions = (coordinates, startName = '출발지', endName = '도착지') => {
    if (!coordinates || coordinates.length < 2) return [];

    const instructions = [];
    
    // 출발지
    instructions.push({
        type: 'start',
        description: `${startName}에서 출발합니다.`,
        position: coordinates[0],
        distance: 0,
        turnType: 200
    });

    // 중간 지점들의 방향 변화 감지
    for (let i = 1; i < coordinates.length - 1; i++) {
        const prev = coordinates[i - 1];
        const current = coordinates[i];
        const next = coordinates[i + 1];

        // 이전 방향과 다음 방향 계산
        const prevBearing = calculateBearing(prev.latitude, prev.longitude, current.latitude, current.longitude);
        const nextBearing = calculateBearing(current.latitude, current.longitude, next.latitude, next.longitude);
        
        // 방향 변화 계산 (각도 차이)
        let angleDiff = nextBearing - prevBearing;
        if (angleDiff > 180) angleDiff -= 360;
        if (angleDiff < -180) angleDiff += 360;

        // 거리 계산
        const distanceToNext = calculateDistance(
            current.latitude, current.longitude,
            next.latitude, next.longitude
        );

        // 방향 변화가 30도 이상이거나 200m 이상 직진하는 경우 안내 추가
        if (Math.abs(angleDiff) > 30 || distanceToNext > 200) {
            let instruction = '';
            let turnType = 11; // 직진

            if (angleDiff > 45) {
                instruction = `우회전 후 ${Math.round(distanceToNext)}미터 직진하세요.`;
                turnType = 13;
            } else if (angleDiff < -45) {
                instruction = `좌회전 후 ${Math.round(distanceToNext)}미터 직진하세요.`;
                turnType = 12;
            } else if (Math.abs(angleDiff) > 15) {
                const direction = getDirectionFromBearing(nextBearing);
                instruction = `${direction} 방향으로 ${Math.round(distanceToNext)}미터 이동하세요.`;
            } else {
                instruction = `${Math.round(distanceToNext)}미터 직진하세요.`;
            }

            if (instruction) {
                instructions.push({
                    type: 'direction',
                    description: instruction,
                    position: current,
                    distance: Math.round(distanceToNext),
                    turnType,
                    bearing: nextBearing
                });
            }
        }
    }

    // 목적지
    instructions.push({
        type: 'destination',
        description: `${endName}에 도착했습니다.`,
        position: coordinates[coordinates.length - 1],
        distance: 0,
        turnType: 201
    });

    return instructions;
};

// 보행자 경로 조회 (상세 안내 포함)
export const getPedestrianDirections = async (start, goal) => {
    try {
        if (!TMAP_APP_KEY) {
            throw new Error('TMAP_APP_KEY가 설정되지 않았습니다.');
        }

        if (!isValidLatLng(start) || !isValidLatLng(goal)) {
            throw new Error('유효하지 않은 좌표입니다.');
        }

        const response = await axios.post(
            'https://apis.openapi.sk.com/tmap/routes/pedestrian',
            {
                startX: start.longitude.toString(),
                startY: start.latitude.toString(),
                endX: goal.longitude.toString(),
                endY: goal.latitude.toString(),
                startName: encodeURIComponent('출발지'),
                endName: encodeURIComponent('목적지'),
                format: 'json',
            },
            {
                headers: {
                    appKey: TMAP_APP_KEY,
                    'Content-Type': 'application/json',
                },
                timeout: 10000,
            }
        );

        const features = response.data.features;
        if (!features || features.length === 0) {
            throw new Error('경로 데이터가 없습니다.');
        }

        const walkRoute = [];
        let totalDistance = 0;
        let totalTime = 0;

        // 경로 좌표 수집
        features.forEach(feature => {
            const { geometry, properties } = feature;

            if (geometry.type === 'LineString') {
                geometry.coordinates.forEach(([longitude, latitude]) => {
                    if (!isNaN(longitude) && !isNaN(latitude)) {
                        walkRoute.push({ latitude, longitude });
                    }
                });
            }

            if (properties) {
                totalDistance += properties.distance || 0;
                totalTime += properties.time || 0;
            }
        });

        // 상세한 안내 지침 생성
        const instructions = generateDetailedWalkInstructions(walkRoute, '출발지', '목적지');

        return {
            route: {
                walk: walkRoute,
                subway: [],
                bus: []
            },
            instructions,
            summary: {
                totalDistance: Math.round(totalDistance),
                totalTime: Math.round(totalTime / 60), // 분 단위
                transportType: 'walk'
            }
        };
    } catch (error) {
        console.error('보행자 경로 조회 오류:', error.message);
        throw error;
    }
};

// 실시간 버스 정보 조회 (버스 정류장 정보)
const getBusStopInfo = async (stationId) => {
    try {
        const response = await axios.get('https://apis.openapi.sk.com/transit/bus/stations/arrival', {
            params: {
                stationId,
                appKey: TMAP_APP_KEY
            },
            timeout: 5000,
        });

        const arrivals = response.data?.result?.arrivalList || [];
        return arrivals.map(arrival => ({
            routeName: arrival.routeName,
            remainingTime: arrival.remainingTime || 0,
            remainingStops: arrival.remainingStops || 0,
            direction: arrival.direction || '',
            vehicleType: arrival.vehicleType || 'bus'
        }));
    } catch (error) {
        console.warn('버스 정보 조회 실패:', error.message);
        return [];
    }
};

// 대중교통 경로 조회 (상세 정보 포함)
export const getTransitDirections = async (start, goal) => {
    try {
        if (!TMAP_APP_KEY) {
            throw new Error('TMAP_APP_KEY가 설정되지 않았습니다.');
        }

        if (!isValidLatLng(start) || !isValidLatLng(goal)) {
            throw new Error('유효하지 않은 좌표입니다.');
        }

        const response = await axios.post(
            'https://apis.openapi.sk.com/transit/routes',
            {
                startX: start.longitude.toString(),
                startY: start.latitude.toString(),
                endX: goal.longitude.toString(),
                endY: goal.latitude.toString(),
                count: 3, // 최대 3개 경로
                lang: 0,
                format: 'json',
            },
            {
                headers: {
                    appKey: TMAP_APP_KEY,
                    'Content-Type': 'application/json',
                },
                timeout: 15000,
            }
        );

        // 거리가 너무 가까운 경우 보행자 경로로 대체
        if (response.data?.result?.status === 11) {
            return getPedestrianDirections(start, goal);
        }

        const itinerary = response.data.metaData?.plan?.itineraries?.[0];
        if (!itinerary || !itinerary.legs) {
            throw new Error('대중교통 경로 데이터가 없습니다.');
        }

        const walkRoute = [];
        const subwayRoute = [];
        const busRoute = [];
        const instructions = [];
        let totalDistance = 0;
        let totalTime = itinerary.totalTime || 0;
        let totalCost = itinerary.fare?.regular?.totalFare || 0;

        // 출발지 안내
        instructions.push({
            type: 'start',
            description: '출발지에서 대중교통 이용을 시작합니다.',
            position: start,
            turnType: 200
        });

        // 각 구간 처리
        for (let legIndex = 0; legIndex < itinerary.legs.length; legIndex++) {
            const leg = itinerary.legs[legIndex];
            
            if (leg.mode === 'WALK' && leg.steps) {
                // 도보 구간
                let walkDistance = 0;
                leg.steps.forEach(step => {
                    if (step.linestring) {
                        const coords = parseLinestring(step.linestring);
                        walkRoute.push(...coords);
                        walkDistance += step.distance || 0;
                    }
                });

                if (walkDistance > 0) {
                    let walkInstruction = '';
                    if (legIndex === 0) {
                        walkInstruction = `${leg.to?.name || '대중교통 승차지'}까지 ${Math.round(walkDistance)}미터 도보 이동하세요.`;
                    } else if (legIndex === itinerary.legs.length - 1) {
                        walkInstruction = `${leg.from?.name || '하차지'}에서 목적지까지 ${Math.round(walkDistance)}미터 도보 이동하세요.`;
                    } else {
                        walkInstruction = `${leg.from?.name || ''}에서 ${leg.to?.name || ''}까지 ${Math.round(walkDistance)}미터 환승 이동하세요.`;
                    }

                    instructions.push({
                        type: 'walk',
                        description: walkInstruction,
                        position: leg.from ? {
                            latitude: parseFloat(leg.from.lat),
                            longitude: parseFloat(leg.from.lon)
                        } : start,
                        distance: Math.round(walkDistance)
                    });
                }

            } else if (leg.mode === 'SUBWAY' && leg.passShape?.linestring) {
                // 지하철 구간
                const coords = parseLinestring(leg.passShape.linestring);
                subwayRoute.push(...coords);
                totalDistance += leg.distance || 0;

                if (leg.start && leg.end) {
                    const stationCount = leg.passStopList?.stationList?.length || 0;
                    const instruction = `${leg.route} 지하철을 타고 ${leg.start.name}에서 ${leg.end.name}까지 이동하세요. (${stationCount}개 정거장, 약 ${Math.round((leg.sectionTime || 0) / 60)}분)`;
                    
                    instructions.push({
                        type: 'subway',
                        description: instruction,
                        position: {
                            latitude: parseFloat(leg.start.lat),
                            longitude: parseFloat(leg.start.lon)
                        },
                        routeName: leg.route,
                        startStation: leg.start.name,
                        endStation: leg.end.name,
                        stationCount: stationCount,
                        sectionTime: Math.round((leg.sectionTime || 0) / 60),
                        direction: leg.direction || ''
                    });
                }

            } else if (leg.mode === 'BUS' && leg.passShape?.linestring) {
                // 버스 구간
                const coords = parseLinestring(leg.passShape.linestring);
                busRoute.push(...coords);
                totalDistance += leg.distance || 0;

                if (leg.start && leg.end) {
                    const stationCount = leg.passStopList?.stationList?.length || 0;
                    let busType = '일반';
                    if (leg.route.includes('간선') || leg.route.includes('지선') || leg.route.includes('순환')) {
                        busType = leg.route.includes('간선') ? '간선' : leg.route.includes('지선') ? '지선' : '순환';
                    }

                    // 실시간 버스 정보 조회 시도
                    let arrivalInfo = '';
                    try {
                        const busInfo = await getBusStopInfo(leg.start.stationID);
                        const targetBus = busInfo.find(bus => bus.routeName === leg.route);
                        if (targetBus && targetBus.remainingTime > 0) {
                            arrivalInfo = ` (약 ${targetBus.remainingTime}분 후 도착 예정)`;
                        }
                    } catch (error) {
                        console.warn('실시간 버스 정보 조회 실패:', error);
                    }

                    const instruction = `${leg.route} ${busType}버스를 타고 ${leg.start.name}에서 ${leg.end.name}까지 이동하세요. (${stationCount}개 정거장, 약 ${Math.round((leg.sectionTime || 0) / 60)}분)${arrivalInfo}`;
                    
                    instructions.push({
                        type: 'bus',
                        description: instruction,
                        position: {
                            latitude: parseFloat(leg.start.lat),
                            longitude: parseFloat(leg.start.lon)
                        },
                        routeName: leg.route,
                        busType: busType,
                        startStation: leg.start.name,
                        endStation: leg.end.name,
                        stationCount: stationCount,
                        sectionTime: Math.round((leg.sectionTime || 0) / 60),
                        direction: leg.direction || '',
                        arrivalInfo: arrivalInfo
                    });
                }
            }
        }

        // 목적지 안내
        instructions.push({
            type: 'destination',
            description: '목적지에 도착했습니다.',
            position: goal,
            turnType: 201
        });

        return {
            route: {
                walk: walkRoute,
                subway: subwayRoute,
                bus: busRoute
            },
            instructions,
            summary: {
                totalDistance: Math.round(totalDistance),
                totalTime: Math.round(totalTime / 60), // 분 단위
                totalCost: totalCost,
                transportType: 'transit'
            }
        };
    } catch (error) {
        console.error('대중교통 경로 조회 오류:', error.message);
        throw error;
    }
};

// 통합 경로 조회 (거리에 따라 자동 선택)
export const getCombinedDirections = async (start, goal) => {
    try {
        if (!isValidLatLng(start) || !isValidLatLng(goal)) {
            throw new Error('유효하지 않은 좌표입니다.');
        }

        const distance = calculateDistance(
            start.latitude,
            start.longitude,
            goal.latitude,
            goal.longitude
        );

        console.log(`목적지까지 직선거리: ${Math.round(distance)}미터`);

        // 500m 이하는 도보, 이상은 대중교통 우선 시도
        if (distance <= 500) {
            console.log('거리가 가까워 도보 경로를 제공합니다.');
            return await getPedestrianDirections(start, goal);
        } else {
            try {
                console.log('대중교통 경로를 탐색합니다.');
                const transitResult = await getTransitDirections(start, goal);
                
                // 대중교통 경로가 도보보다 시간이 오래 걸리면 도보 추천
                const walkTime = distance / (4000/60); // 도보 4km/h 기준 시간(분)
                if (transitResult.summary.totalTime > walkTime * 1.5) {
                    console.log('대중교통보다 도보가 더 효율적입니다.');
                    const walkResult = await getPedestrianDirections(start, goal);
                    walkResult.alternativeAvailable = true;
                    walkResult.alternativeInfo = `대중교통 이용시 ${transitResult.summary.totalTime}분 소요`;
                    return walkResult;
                }
                
                return transitResult;
            } catch (error) {
                // 대중교통 실패시 도보로 대체
                console.warn('대중교통 경로 실패, 도보 경로로 대체:', error.message);
                const walkResult = await getPedestrianDirections(start, goal);
                walkResult.fallbackReason = '대중교통 경로를 찾을 수 없어 도보 경로를 제공합니다.';
                return walkResult;
            }
        }
    } catch (error) {
        console.error('통합 경로 조회 오류:', error.message);
        throw error;
    }
};

// Helper Functions
function parseLinestring(linestring) {
    if (!linestring) return [];
    
    return linestring.split(' ').map(coord => {
        const [longitude, latitude] = coord.split(',').map(parseFloat);
        if (isNaN(longitude) || isNaN(latitude)) return null;
        return { latitude, longitude };
    }).filter(coord => coord !== null);
}

function getInstructionType(turnType) {
    switch (turnType) {
        case 200: return 'start';
        case 201: return 'destination';
        case 211:
        case 212:
        case 213: return 'crosswalk';
        case 125: return 'overpass';
        case 126: return 'underground';
        case 127: return 'stairs';
        case 128: return 'ramp';
        case 12: return 'left';
        case 13: return 'right';
        case 11: return 'straight';
        default: return 'direction';
    }
}