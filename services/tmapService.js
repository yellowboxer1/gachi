import axios from 'axios';
import { TMAP_APP_KEY } from '@env';
import { calculateDistance } from '../utils/locationUtils';

// 좌표 검증 헬퍼 함수
function validateCoordinates(coords) {
    return coords.filter(coord => 
        coord && 
        typeof coord.latitude === 'number' && 
        typeof coord.longitude === 'number' && 
        !isNaN(coord.latitude) && 
        !isNaN(coord.longitude) &&
        coord.latitude >= -90 && coord.latitude <= 90 &&
        coord.longitude >= -180 && coord.longitude <= 180
    );
}

function validateInstructions(instructions) {
    return instructions.filter(instruction => 
        instruction && 
        instruction.position && 
        typeof instruction.position.latitude === 'number' && 
        typeof instruction.position.longitude === 'number' && 
        !isNaN(instruction.position.latitude) && 
        !isNaN(instruction.position.longitude) &&
        instruction.position.latitude >= -90 && instruction.position.latitude <= 90 &&
        instruction.position.longitude >= -180 && instruction.position.longitude <= 180
    );
}

export const getPoiCoordinates = async (query, userLocation = null) => {
    try {
        if (!TMAP_APP_KEY) {
            throw new Error('TMAP_APP_KEY가 .env에서 로드되지 않았습니다.');
        }
        console.log('사용된 TMAP_APP_KEY:', TMAP_APP_KEY);

        const params = {
            version: 1,
            searchKeyword: query,
            appKey: TMAP_APP_KEY,
            count: 1,
        };

        if (userLocation) {
            params.centerLat = userLocation.latitude;
            params.centerLon = userLocation.longitude;
        }

        console.log('Tmap POI API 호출 - 쿼리:', query, '위치:', userLocation);
        const response = await axios.get('https://apis.openapi.sk.com/tmap/pois', {
            params,
            timeout: 5000, // 5초 타임아웃
        });

        if (response.status !== 200) {
            throw new Error(`POI 검색 실패: 상태 코드 ${response.status}`);
        }

        console.log('Tmap POI API 응답:', JSON.stringify(response.data, null, 2));

        const poi = response.data.searchPoiInfo?.pois?.poi?.[0];
        if (!poi) {
            throw new Error(`"${query}"에 대한 좌표를 찾을 수 없습니다.`);
        }

        // 수정: latitude를 먼저 오게 변경, 명시적 변환 추가
        const latitude = parseFloat(poi.frontLat);
        const longitude = parseFloat(poi.frontLon);
        
        if (isNaN(latitude) || isNaN(longitude)) {
            throw new Error('좌표 형식이 잘못되었습니다.');
        }

        // 유효 범위 검사 추가
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            throw new Error('좌표가 유효 범위를 벗어났습니다.');
        }

        console.log(`POI 검색 성공 - ${query}:`, { latitude, longitude });
        return { latitude, longitude };
    } catch (error) {
        console.error('Tmap POI API 호출 오류:', error.response ? error.response.data : error.message);
        throw error;
    }
};

export const getTransitDirections = async (start, goal) => {
    try {
        if (!TMAP_APP_KEY) {
            throw new Error('TMAP_APP_KEY가 .env에서 로드되지 않았습니다.');
        }

        // 명시적 타입 변환 및 유효성 검사
        if (!start || !start.latitude || !start.longitude || 
            isNaN(parseFloat(start.latitude)) || isNaN(parseFloat(start.longitude))) {
            throw new Error('출발지 좌표가 유효하지 않습니다.');
        }

        if (!goal || !goal.latitude || !goal.longitude || 
            isNaN(parseFloat(goal.latitude)) || isNaN(parseFloat(goal.longitude))) {
            throw new Error('목적지 좌표가 유효하지 않습니다.');
        }

        const startX = parseFloat(start.longitude);
        const startY = parseFloat(start.latitude);
        const endX = parseFloat(goal.longitude);
        const endY = parseFloat(goal.latitude);

        console.log('Tmap Transit API 호출 - 시작:', { startX, startY }, '목적지:', { endX, endY });

        const response = await axios.post(
            'https://apis.openapi.sk.com/transit/routes',
            {
                startX: startX.toString(),
                startY: startY.toString(),
                endX: endX.toString(),
                endY: endY.toString(),
                count: 1,
                lang: 0,
                format: 'json',
            },
            {
                headers: {
                    appKey: TMAP_APP_KEY,
                    'Content-Type': 'application/json',
                },
                timeout: 10000, // 10초 타임아웃
            }
        );

        if (response.status !== 200) {
            throw new Error(`대중교통 경로 조회 실패: 상태 코드 ${response.status}`);
        }

        console.log('Tmap Transit API 응답:', JSON.stringify(response.data, null, 2));

        if (response.data?.result?.status === 11) {
            console.log('출발지와 도착지가 너무 가까워 보행자 경로만 사용합니다.');
            return getPedestrianDirections(start, goal);
        }

        const itinerary = response.data.metaData?.plan?.itineraries?.[0];
        if (!itinerary || !itinerary.legs) {
            throw new Error('유효한 대중교통 경로 데이터가 없습니다.');
        }

        const walkRouteCoords = [];
        const subwayRouteCoords = [];
        const busRouteCoords = [];
        const navigationInstructions = [];

        // 출발지 안내 추가 (명시적 변환)
        navigationInstructions.push({
            type: 'start',
            description: '출발지입니다.',
            position: {
                latitude: parseFloat(start.latitude),
                longitude: parseFloat(start.longitude)
            },
            turnType: 200
        });

        itinerary.legs.forEach((leg, index) => {
            console.log(`Leg ${index} - mode: ${leg.mode}, start: ${leg.start?.name}, end: ${leg.end?.name}`);

            if (leg.mode === 'WALK' && leg.steps && Array.isArray(leg.steps)) {
                const walkCoords = [];
                
                leg.steps.forEach((step, stepIndex) => {
                    if (!step.linestring) {
                        console.warn(`Step ${stepIndex}에 linestring이 없습니다:`, step);
                        return;
                    }
                    
                    const coords = step.linestring.split(' ').map(coord => {
                        const [longitudeStr, latitudeStr] = coord.split(',');
                        const longitude = parseFloat(longitudeStr);
                        const latitude = parseFloat(latitudeStr);
                        
                        if (isNaN(longitude) || isNaN(latitude) ||
                            latitude < -90 || latitude > 90 || 
                            longitude < -180 || longitude > 180) {
                            console.warn(`Step ${stepIndex} 잘못된 좌표 형식:`, coord);
                            return null;
                        }
                        return { latitude, longitude };
                    }).filter(coord => coord !== null);

                    if (coords.length > 0) {
                        walkCoords.push(...coords);
                    }

                    // 각 걷기 단계마다 안내 추가
                    const description = step.description || `${step.distance}m 이동`;
                    let type = 'direction';
                    let turnType = 11; // 기본 직진

                    if (description.includes('우회전')) {
                        type = 'right';
                        turnType = 13;
                    } else if (description.includes('좌회전')) {
                        type = 'left';
                        turnType = 12;
                    } else if (description.includes('횡단보도')) {
                        type = 'crosswalk';
                        turnType = 211;
                    } else if (description.includes('육교')) {
                        type = 'overpass';
                        turnType = 125;
                    } else if (description.includes('지하보도')) {
                        type = 'underground';
                        turnType = 126;
                    } else if (description.includes('계단')) {
                        type = 'stairs';
                        turnType = 127;
                    } else if (description.includes('경사로')) {
                        type = 'ramp';
                        turnType = 128;
                    }

                    if (coords.length > 0) {
                        // 명시적인 좌표 포맷
                        const position = {
                            latitude: parseFloat(coords[0].latitude),
                            longitude: parseFloat(coords[0].longitude)
                        };
                        
                        if (!isNaN(position.latitude) && !isNaN(position.longitude)) {
                            navigationInstructions.push({
                                type,
                                turnType,
                                description,
                                position
                            });
                        }
                    }
                });

                if (walkCoords.length > 0) {
                    walkRouteCoords.push(...walkCoords);
                }
            } else if (leg.mode === 'SUBWAY' && leg.passShape && leg.passShape.linestring) {
                console.log(`PassShape linestring for SUBWAY:`, leg.passShape.linestring);
                const coords = leg.passShape.linestring.split(' ').map(coord => {
                    const [longitudeStr, latitudeStr] = coord.split(',');
                    const longitude = parseFloat(longitudeStr);
                    const latitude = parseFloat(latitudeStr);
                    
                    if (isNaN(longitude) || isNaN(latitude) ||
                        latitude < -90 || latitude > 90 || 
                        longitude < -180 || longitude > 180) {
                        console.warn(`PassShape SUBWAY 잘못된 좌표 형식:`, coord);
                        return null;
                    }
                    return { latitude, longitude };
                }).filter(coord => coord !== null);

                if (coords.length > 0) {
                    subwayRouteCoords.push(...coords);
                }

                // 지하철 탑승 안내 (명시적 변환 및 유효성 검사)
                if (leg.start && leg.start.lat && leg.start.lon) {
                    const lat = parseFloat(leg.start.lat);
                    const lon = parseFloat(leg.start.lon);
                    
                    if (!isNaN(lat) && !isNaN(lon) && 
                        lat >= -90 && lat <= 90 && 
                        lon >= -180 && lon <= 180) {
                        navigationInstructions.push({
                            type: 'subway',
                            description: `${leg.route} 지하철 탑승`,
                            position: { latitude: lat, longitude: lon },
                            turnType: 0
                        });
                    }
                }
            } else if (leg.mode === 'BUS' && leg.passShape && leg.passShape.linestring) {
                console.log(`PassShape linestring for BUS:`, leg.passShape.linestring);
                const coords = leg.passShape.linestring.split(' ').map(coord => {
                    const [longitudeStr, latitudeStr] = coord.split(',');
                    const longitude = parseFloat(longitudeStr);
                    const latitude = parseFloat(latitudeStr);
                    
                    if (isNaN(longitude) || isNaN(latitude) ||
                        latitude < -90 || latitude > 90 || 
                        longitude < -180 || longitude > 180) {
                        console.warn(`PassShape BUS 잘못된 좌표 형식:`, coord);
                        return null;
                    }
                    return { latitude, longitude };
                }).filter(coord => coord !== null);

                if (coords.length > 0) {
                    busRouteCoords.push(...coords);
                }

                // 버스 탑승 안내 (명시적 변환 및 유효성 검사)
                if (leg.start && leg.start.lat && leg.start.lon) {
                    const lat = parseFloat(leg.start.lat);
                    const lon = parseFloat(leg.start.lon);
                    
                    if (!isNaN(lat) && !isNaN(lon) && 
                        lat >= -90 && lat <= 90 && 
                        lon >= -180 && lon <= 180) {
                        navigationInstructions.push({
                            type: 'bus',
                            description: `${leg.route} 버스 탑승`,
                            position: { latitude: lat, longitude: lon },
                            turnType: 0
                        });
                    }
                }
            }
        });

        // 목적지 안내 추가 (명시적 변환)
        navigationInstructions.push({
            type: 'destination',
            description: '목적지에 도착했습니다.',
            position: {
                latitude: parseFloat(goal.latitude),
                longitude: parseFloat(goal.longitude)
            },
            turnType: 201
        });

        // 최종 검증
        const validWalkRoute = validateCoordinates(walkRouteCoords);
        const validSubwayRoute = validateCoordinates(subwayRouteCoords);
        const validBusRoute = validateCoordinates(busRouteCoords);
        const validInstructions = validateInstructions(navigationInstructions);

        // 경로가 없는 경우 확인
        const hasWalkRoute = validWalkRoute.length >= 2;
        const hasSubwayRoute = validSubwayRoute.length >= 2;
        const hasBusRoute = validBusRoute.length >= 2;

        if (!hasWalkRoute && !hasSubwayRoute && !hasBusRoute) {
            console.warn('포맷된 경로 좌표가 부족합니다.');
            throw new Error('경로 좌표가 부족합니다.');
        }

        console.log('포맷된 대중교통 경로:', {
            walk: validWalkRoute.length,
            subway: validSubwayRoute.length,
            bus: validBusRoute.length
        });
        console.log('내비게이션 안내 정보:', validInstructions.length, '개 항목');
        console.log('안내 정보 상세:', validInstructions.map(i => i.description));

        return {
            route: {
                walk: validWalkRoute,
                subway: validSubwayRoute,
                bus: validBusRoute
            },
            instructions: validInstructions
        };
    } catch (error) {
        console.error('Tmap Transit API 호출 오류 :', error.response ? error.response.data : error.message);
        throw error;
    }
};

export const getPedestrianDirections = async (start, goal) => {
    try {
        if (!TMAP_APP_KEY) {
            throw new Error('TMAP_APP_KEY가 .env에서 로드되지 않았습니다.');
        }

        // 명시적 타입 변환 및 유효성 검사
        if (!start || !start.latitude || !start.longitude || 
            isNaN(parseFloat(start.latitude)) || isNaN(parseFloat(start.longitude))) {
            throw new Error('출발지 좌표가 유효하지 않습니다.');
        }

        if (!goal || !goal.latitude || !goal.longitude || 
            isNaN(parseFloat(goal.latitude)) || isNaN(parseFloat(goal.longitude))) {
            throw new Error('목적지 좌표가 유효하지 않습니다.');
        }

        const startX = parseFloat(start.longitude);
        const startY = parseFloat(start.latitude);
        const endX = parseFloat(goal.longitude);
        const endY = parseFloat(goal.latitude);

        console.log('Tmap Pedestrian API 호출 - 시작:', { startX, startY }, '목적지:', { endX, endY });

        const response = await axios.post(
            'https://apis.openapi.sk.com/tmap/routes/pedestrian',
            {
                startX: startX.toString(),
                startY: startY.toString(),
                endX: endX.toString(),
                endY: endY.toString(),
                startName: encodeURIComponent('출발지'),
                endName: encodeURIComponent('목적지'),
                format: 'json',
            },
            {
                headers: {
                    appKey: TMAP_APP_KEY,
                    'Content-Type': 'application/json',
                },
                timeout: 10000, // 10초 타임아웃
            }
        );

        if (response.status !== 200) {
            throw new Error(`보행자 경로 조회 실패: 상태 코드 ${response.status}`);
        }

        console.log('Tmap Pedestrian API 응답:', JSON.stringify(response.data, null, 2));

        const features = response.data.features;
        if (!features || features.length === 0) {
            throw new Error('유효한 보행자 경로 데이터가 없습니다.');
        }

        const walkRouteCoords = [];
        const navigationInstructions = [];

        // Point 타입 객체를 따로 모읍니다 (안내지점)
        const pointFeatures = features.filter(f => 
            f.geometry && f.geometry.type === 'Point' && f.properties
        );
        
        // LineString 타입 객체를 따로 모읍니다 (경로)
        const lineFeatures = features.filter(f => 
            f.geometry && f.geometry.type === 'LineString' && f.geometry.coordinates
        );

        // 경로 좌표를 추출합니다
        lineFeatures.forEach(feature => {
            const coords = feature.geometry.coordinates.map(([longitude, latitude]) => {
                // 명시적 형변환 및 보다 엄격한 유효성 검사
                const lng = parseFloat(longitude);
                const lat = parseFloat(latitude);
                
                if (isNaN(lng) || isNaN(lat) ||
                    lat < -90 || lat > 90 || 
                    lng < -180 || lng > 180) {
                    console.warn('잘못된 좌표 형식:', [longitude, latitude]);
                    return null;
                }
                return { latitude: lat, longitude: lng };
            }).filter(coord => coord !== null);

            if (coords.length > 0) {
                walkRouteCoords.push(...coords);
            }
        });

        // 안내 지점을 추출합니다 (모든 Point 객체 처리)
        pointFeatures.forEach(feature => {
            if (!feature.geometry || !feature.geometry.coordinates || !feature.properties) {
                return;
            }

            const [longitude, latitude] = feature.geometry.coordinates;
            // 명시적 형변환 및 유효성 검사
            const lng = parseFloat(longitude);
            const lat = parseFloat(latitude);
            
            if (isNaN(lng) || isNaN(lat) ||
                lat < -90 || lat > 90 || 
                lng < -180 || lng > 180) {
                console.warn('안내 지점 좌표가 유효하지 않음:', feature.geometry.coordinates);
                return; // 유효하지 않은 좌표는 건너뜀
            }
            
            const props = feature.properties;
            const turnType = props.turnType ? parseInt(props.turnType) : 0;
            const description = props.description || '';
            
            // 안내 지점 유형 결정
            let type = 'direction'; // 기본 유형
            
            if (turnType === 200) type = 'start';
            else if (turnType === 201) type = 'destination';
            else if (turnType === 211 || turnType === 212 || turnType === 213) type = 'crosswalk';
            else if (turnType === 125) type = 'overpass'; // 육교
            else if (turnType === 126) type = 'underground'; // 지하보도
            else if (turnType === 127) type = 'stairs'; // 계단
            else if (turnType === 128) type = 'ramp'; // 경사로
            else if (turnType === 129) type = 'stairsramp'; // 계단+경사로
            else if (turnType === 12) type = 'left'; // 좌회전
            else if (turnType === 13) type = 'right'; // 우회전
            else if (turnType === 11) type = 'straight'; // 직진
            
            navigationInstructions.push({
                type,
                turnType,
                description,
                position: { latitude: lat, longitude: lng }
            });
        });

        // 최종 검증
        const validWalkRoute = validateCoordinates(walkRouteCoords);
        const validInstructions = validateInstructions(navigationInstructions);

        // 경로가 없거나 부족한 경우 처리
        if (validWalkRoute.length < 2) {
            console.warn('포맷된 보행자 경로 좌표가 2개 미만입니다:', validWalkRoute);
            throw new Error('보행자 경로 좌표가 부족합니다.');
        }

        // 기본 안내 정보가 없으면 추가
        if (validInstructions.length === 0) {
            const safeStart = {
                latitude: parseFloat(start.latitude),
                longitude: parseFloat(start.longitude)
            };
            
            const safeGoal = {
                latitude: parseFloat(goal.latitude),
                longitude: parseFloat(goal.longitude)
            };
            
            if (!isNaN(safeStart.latitude) && !isNaN(safeStart.longitude)) {
                navigationInstructions.push({
                    type: 'start',
                    description: '경로안내를 시작합니다.',
                    position: safeStart,
                    turnType: 200
                });
            }
            
            if (!isNaN(safeGoal.latitude) && !isNaN(safeGoal.longitude)) {
                navigationInstructions.push({
                    type: 'destination',
                    description: '목적지에 도착했습니다.',
                    position: safeGoal,
                    turnType: 201
                });
            }
        }

        // 결과 정렬 (인덱스 순서로)
        navigationInstructions.sort((a, b) => {
            const indexA = pointFeatures.findIndex(f => 
                f.geometry.coordinates[0] === a.position.longitude && 
                f.geometry.coordinates[1] === a.position.latitude
            );
            const indexB = pointFeatures.findIndex(f => 
                f.geometry.coordinates[0] === b.position.longitude && 
                f.geometry.coordinates[1] === b.position.latitude
            );
            
            // 일치하는 항목이 없는 경우 기본값 사용
            const valueA = indexA !== -1 ? indexA : Number.MAX_SAFE_INTEGER;
            const valueB = indexB !== -1 ? indexB : Number.MAX_SAFE_INTEGER;
            
            return valueA - valueB;
        });

        // 최종 유효성 검증
        const finalValidInstructions = validateInstructions(navigationInstructions);

        console.log('포맷된 보행자 경로:', validWalkRoute.length, '개 좌표');
        console.log('내비게이션 안내 정보:', finalValidInstructions.length, '개 항목');
        console.log('안내 정보 상세:', finalValidInstructions.map(i => i.description));
        
        return {
            route: {
                walk: validWalkRoute,
                subway: [],
                bus: []
            },
            instructions: finalValidInstructions
        };
    } catch (error) {
        console.error('Tmap Pedestrian API 호출 오류:', error.response ? error.response.data : error.message);
        throw error;
    }
};

export const getCombinedDirections = async (start, goal) => {
    try {
        console.log('통합 경로 조회 시작:', { goal, start });
        
        // 입력 좌표 검증
        if (!start || !start.latitude || !start.longitude || 
            isNaN(parseFloat(start.latitude)) || isNaN(parseFloat(start.longitude))) {
            throw new Error('출발지 좌표가 유효하지 않습니다.');
        }

        if (!goal || !goal.latitude || !goal.longitude || 
            isNaN(parseFloat(goal.latitude)) || isNaN(parseFloat(goal.longitude))) {
            throw new Error('목적지 좌표가 유효하지 않습니다.');
        }

        // 좌표 형식 통일
        const safeStart = {
            latitude: parseFloat(start.latitude),
            longitude: parseFloat(start.longitude)
        };
        
        const safeGoal = {
            latitude: parseFloat(goal.latitude),
            longitude: parseFloat(goal.longitude)
        };
        
        const distance = calculateDistance(
            safeStart.latitude, 
            safeStart.longitude, 
            safeGoal.latitude, 
            safeGoal.longitude
        );
        
        const distanceThreshold = 500; // 500m (임계 거리 설정)

        if (distance <= distanceThreshold) {
            // 가까운 거리: 도보 경로만 표시
            console.log('가까운 거리, 도보 경로만 사용합니다.');
            return await getPedestrianDirections(safeStart, safeGoal);
        } else {
            // 먼 거리: 대중교통 경로 우선 탐색 후, 실패 시 도보 경로 탐색
            console.log('먼 거리, 대중교통 경로 우선 탐색');
            try {
                return await getTransitDirections(safeStart, safeGoal);
            } catch (transitError) {
                console.warn('대중교통 경로 탐색 실패, 도보 경로 탐색:', transitError);
                return await getPedestrianDirections(safeStart, safeGoal);
            }
        }
    } catch (error) {
        console.error('통합 경로 조회 오류:', error);
        throw error;
    }
};