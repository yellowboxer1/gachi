import { getTransitDirections, getPedestrianDirections } from '../services/tmapService';
import { isCoordinateNearPath, calculateDistance, isValidLatLng } from './locationUtils';

// 좌표가 유효한지 검사하는 강화된 함수
const ensureValidCoordinate = (coord) => {
  if (!coord) return null;
  
  const lat = typeof coord.latitude === 'number' ? coord.latitude : parseFloat(coord.latitude);
  const lng = typeof coord.longitude === 'number' ? coord.longitude : parseFloat(coord.longitude);
  
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    console.error('Invalid coordinate:', coord);
    return null;
  }
  
  return { latitude: lat, longitude: lng };
};

// linestring 파싱 함수 개선
const parseLinestring = (linestring) => {
  if (!linestring || typeof linestring !== 'string') {
    console.error('Invalid linestring:', linestring);
    return [];
  }
  
  return linestring.split(' ')
    .map(coord => {
      try {
        const [lon, lat] = coord.split(',').map(num => parseFloat(num.trim()));
        if (isNaN(lon) || isNaN(lat) || !isFinite(lon) || !isFinite(lat)) {
          console.error('Invalid coordinate in linestring:', coord);
          return null;
        }
        return { latitude: lat, longitude: lon };
      } catch (error) {
        console.error('Error parsing coordinate:', coord, error);
        return null;
      }
    })
    .filter(coord => coord !== null);
};

// 경로 배열의 모든 좌표가 유효한지 확인
const validateRoute = (routeArray) => {
  if (!routeArray || !Array.isArray(routeArray) || routeArray.length < 2) {
    return [];
  }
  
  return routeArray
    .map(ensureValidCoordinate)
    .filter(coord => coord !== null);
};

/**
 * 안내 정보를 앱 표준 형식으로 변환하는 함수
 */
export const convertGuideToInstructions = (guideInfo, formattedPath) => {
    if (!guideInfo || !Array.isArray(guideInfo)) return [];
    
    return guideInfo.map(guide => {
        let type = 'normal';
        let description = guide.description;
        
        // TMap turnType 기반 분기점 유형 매핑
        if (guide.turnType) {
            switch (guide.turnType) {
                case 125:
                    type = 'overpass'; // 육교
                    description = description || '육교를 이용하여 건너세요.';
                    break;
                case 126:
                    type = 'underground'; // 지하보도
                    description = description || '지하보도를 이용하여 건너세요.';
                    break;
                case 127:
                    type = 'stairs'; // 계단 진입
                    description = description || '계단이 있습니다. 주의하세요.';
                    break;
                case 128:
                    type = 'ramp'; // 경사로 진입
                    description = description || '경사로가 있습니다.';
                    break;
                case 129:
                    type = 'stairsramp'; // 계단+경사로 진입
                    description = description || '계단과 경사로가 있습니다. 주의하세요.';
                    break;
                case 211:
                case 212:
                case 213:
                case 214:
                case 215:
                case 216:
                case 217:
                    type = 'crosswalk'; // 횡단보도
                    description = description || '횡단보도를 건너세요.';
                    break;
                case 12:
                    type = 'left'; // 좌회전
                    description = description || '좌회전 하세요.';
                    break;
                case 13:
                    type = 'right'; // 우회전
                    description = description || '우회전 하세요.';
                    break;
                case 11:
                    type = 'straight'; // 직진
                    description = description || '직진하세요.';
                    break;
                case 14:
                    type = 'uturn'; // 유턴
                    description = description || '유턴하세요.';
                    break;
                case 200:
                    type = 'start'; // 출발지
                    description = description || '출발지입니다.';
                    break;
                case 201:
                    type = 'destination'; // 목적지
                    description = description || '목적지입니다.';
                    break;
            }
        } else if (description) {
            // 기존 설명 기반 매핑 (fallback)
            if (description.includes('횡단보도')) {
                type = 'crosswalk';
            } else if (description.includes('계단')) {
                type = 'stairs';
            } else if (description.includes('육교')) {
                type = 'overpass';
            } else if (description.includes('지하보도')) {
                type = 'underground';
            } else if (description.includes('지하철') || description.includes('역')) {
                type = 'subway';
            } else if (description.includes('버스')) {
                type = 'bus';
            } else if (description.includes('좌회전')) {
                type = 'left';
            } else if (description.includes('우회전')) {
                type = 'right';
            } else if (description.includes('직진')) {
                type = 'straight';
            }
        }
        
        // 좌표 유효성 확인
        let position = null;
        if (guide.position) {
            position = ensureValidCoordinate(guide.position);
        } else if (formattedPath && guide.pointIndex !== undefined && formattedPath[guide.pointIndex]) {
            position = ensureValidCoordinate(formattedPath[guide.pointIndex]);
        }
        
        return {
            type,
            description,
            position,
            distance: guide.distance || 0,
            duration: guide.duration || 0,
            turnType: guide.turnType // 원본 turnType 보존
        };
    }).filter(instr => instr.position != null);
};

/**
 * 대중교통 및 보행자 경로 데이터를 통합하는 함수
 */
export const getCombinedDirections = async (start, goal) => {
    try {
        console.log('통합 경로 조회 시작:', { start, goal });
        
        // 시작점과 목적지 좌표 검증
        const validStart = ensureValidCoordinate(start);
        const validGoal = ensureValidCoordinate(goal);
        
        if (!validStart || !validGoal) {
            throw new Error('유효하지 않은 시작점 또는 목적지 좌표입니다.');
        }
        
        // 1. TMap API에서 대중교통 경로 조회
        let transitRoute = [];
        let transitInstructions = [];
        let useTransitRoute = false;
        
        try {
            const transitResult = await getTransitDirections(validStart, validGoal);
            transitRoute = validateRoute(transitResult.formattedRoute || []);
            
            // 좌표 검증 후 안내 정보 설정
            if (transitResult.navigationInstructions) {
                transitInstructions = transitResult.navigationInstructions
                    .map(instr => ({
                        ...instr,
                        position: instr.position ? ensureValidCoordinate(instr.position) : null
                    }))
                    .filter(instr => !instr.position || instr.position !== null);
            }
            
            if (transitRoute.length >= 2) {
                useTransitRoute = true;
                console.log('대중교통 경로 조회 성공:', 
                    transitRoute.length, '좌표,', 
                    transitInstructions.length, '안내'
                );
            } else {
                console.log('유효한 대중교통 경로가 없습니다. 보행자 경로만 사용합니다.');
            }
        } catch (error) {
            console.error('대중교통 경로 조회 실패:', error);
            console.log('보행자 경로만 사용합니다.');
        }
        
        // 2. TMap API에서 보행자 경로 조회
        let pedestrianRoute = [];
        let pedestrianInstructions = [];
        
        try {
            const pedestrianResult = await getPedestrianDirections(validStart, validGoal);
            pedestrianRoute = validateRoute(pedestrianResult.formattedRoute || []);
            
            // 좌표 검증 후 안내 정보 설정
            if (pedestrianResult.navigationInstructions) {
                pedestrianInstructions = pedestrianResult.navigationInstructions
                    .map(instr => ({
                        ...instr,
                        position: instr.position ? ensureValidCoordinate(instr.position) : null
                    }))
                    .filter(instr => !instr.position || instr.position !== null);
            }
            
            // 계단 정보 추가
            if (pedestrianRoute.length > 2) {
                for (let i = 1; i < pedestrianRoute.length - 1; i++) {
                    const prevPoint = pedestrianRoute[i-1];
                    const currPoint = pedestrianRoute[i];
                    
                    if (prevPoint && currPoint && prevPoint.altitude && currPoint.altitude && 
                        Math.abs(currPoint.altitude - prevPoint.altitude) > 2) {
                        
                        const direction = currPoint.altitude > prevPoint.altitude ? '올라가는' : '내려가는';
                        if (isValidLatLng(currPoint)) {
                            pedestrianInstructions.push({
                                type: 'stairs',
                                description: `${direction} 계단이 있습니다. 주의하세요.`,
                                position: currPoint,
                                distance: calculateDistance(prevPoint, currPoint)
                            });
                        }
                    }
                }
            }
            
            console.log('보행자 경로 조회 성공:', 
                pedestrianRoute.length, '좌표,', 
                pedestrianInstructions.length, '안내'
            );
        } catch (error) {
            console.error('보행자 경로 조회 실패:', error);
            
            // 보행자 경로도 실패한 경우, 기본 경로 생성
            if (transitRoute.length < 2) {
                // 직선 경로 생성
                pedestrianRoute = [validStart, validGoal];
                pedestrianInstructions = [
                    { 
                        type: 'start', 
                        description: '현재 위치에서 출발합니다.', 
                        position: validStart,
                        turnType: 200
                    },
                    { 
                        type: 'destination', 
                        description: '목적지에 도착했습니다.', 
                        position: validGoal,
                        turnType: 201
                    }
                ];
                console.log('기본 직선 경로를 생성했습니다.');
            }
        }
        
        // 3. 경로 분류 및 통합
        // 대중교통 경로가 없거나 짧은 경우, 보행자 경로만 사용
        let walkRoute = [];
        let subwayRoute = [];
        let busRoute = [];
        
        if (!useTransitRoute || transitRoute.length < 2) {
            console.log('보행자 경로만 사용합니다. 대중교통 경로는 제외합니다.');
            walkRoute = pedestrianRoute;
            // 대중교통 경로는 빈 배열로 설정
            subwayRoute = [];
            busRoute = [];
        } else {
            // 대중교통 경로가 있는 경우 기존 로직 사용
            walkRoute = pedestrianRoute.length > 0 ? pedestrianRoute : [];
            
            // 대중교통 경로에서 지하철과 버스 경로 분리
            subwayRoute = transitRoute.filter(coord => 
                coord && isValidLatLng(coord) && 
                transitInstructions.some(instr => 
                    instr.type === 'subway' && instr.position && 
                    isCoordinateNearPathArray(coord, transitRoute, 0.0005)
                )
            );
            
            busRoute = transitRoute.filter(coord => 
                coord && isValidLatLng(coord) && 
                transitInstructions.some(instr => 
                    instr.type === 'bus' && instr.position && 
                    isCoordinateNearPathArray(coord, transitRoute, 0.0005)
                )
            );
        }
        
        const combinedRoute = {
            walk: walkRoute,
            subway: subwayRoute,
            bus: busRoute
        };
        
        // 4. 안내 정보 통합
        let combinedInstructions = [];
        
        if (!useTransitRoute || transitRoute.length < 2) {
            // 대중교통 경로가 없는 경우 보행자 안내만 사용
            combinedInstructions = pedestrianInstructions.filter(instr => instr.position !== null);
        } else {
            // 대중교통 경로가 있는 경우 통합
            combinedInstructions = [
                ...pedestrianInstructions,
                ...transitInstructions
            ].filter(instr => instr.position !== null);
            
            // 경로 진입점에 계단 정보가 있는지 확인하고 추가 (지하철 역 진입 시 계단 가정)
            transitInstructions.forEach(instr => {
                if (instr.type === 'subway' && instr.position) {
                    // 좌표 검증
                    const validPosition = ensureValidCoordinate(instr.position);
                    if (validPosition) {
                        // 지하철 진입 지점에 계단 정보 추가
                        combinedInstructions.push({
                            type: 'stairs',
                            description: '지하철역 계단이 있습니다. 주의하세요.',
                            position: validPosition,
                            distance: 10 // 가정
                        });
                    }
                }
            });
        }
        
        // 안내 정보가 없는 경우 기본 안내 추가
        if (combinedInstructions.length === 0) {
            if (validStart) {
                combinedInstructions.push({ 
                    type: 'start', 
                    description: '현재 위치에서 출발합니다.', 
                    position: validStart,
                    turnType: 200
                });
            }
            
            if (validGoal) {
                combinedInstructions.push({ 
                    type: 'destination', 
                    description: '목적지에 도착했습니다.', 
                    position: validGoal,
                    turnType: 201
                });
            }
        }
        
        // 거리에 따라 안내 정보 정렬 (유효하지 않은 좌표 처리)
        combinedInstructions.sort((a, b) => {
            if (!a.position || !b.position) return 0;
            const distA = calculateDistance(validStart, a.position);
            const distB = calculateDistance(validStart, b.position);
            if (isNaN(distA) || isNaN(distB)) return 0;
            return distA - distB;
        });
        
        console.log('통합 경로 생성 완료:', 
            '도보:', combinedRoute.walk.length, 
            '지하철:', combinedRoute.subway.length, 
            '버스:', combinedRoute.bus.length, 
            '안내:', combinedInstructions.length
        );
        
        return { 
            route: combinedRoute,
            instructions: combinedInstructions 
        };
    } catch (error) {
        console.error('경로 통합 오류:', error);
        throw new Error('경로 정보를 통합하는 데 실패했습니다: ' + error.message);
    }
};

/**
 * 좌표가 경로 배열의 일부 좌표와 근접한지 확인
 */
function isCoordinateNearPathArray(coord, pathArray, threshold = 0.0001) {
    if (!coord || !Array.isArray(pathArray)) return false;
    
    return pathArray.some(pathCoord => 
        pathCoord && coord && 
        isCoordinateNearPath(coord, pathCoord, threshold)
    );
}

// Export additional utility functions for use in other modules
export {
    ensureValidCoordinate,
    parseLinestring,
    validateRoute
};