// 좌표가 유효한지 확인하는 함수 (강화된 버전)
export const isValidLatLng = (coord) => {
    // null, undefined 체크
    if (!coord) {
        console.warn('좌표가 null 또는 undefined');
        return false;
    }
    
    // 객체 형식 확인
    if (typeof coord !== 'object') {
        console.warn('좌표가 객체 형식이 아님:', typeof coord);
        return false;
    }
    
    // 필수 속성 확인
    if (!('latitude' in coord) || !('longitude' in coord)) {
        console.warn('좌표에 latitude 또는 longitude 속성이 없음:', Object.keys(coord));
        return false;
    }
    
    // 값 검증 및 타입 변환
    let lat = coord.latitude;
    let lng = coord.longitude;
    
    // 문자열을 숫자로 변환
    if (typeof lat === 'string') {
        lat = parseFloat(lat);
    }
    if (typeof lng === 'string') {
        lng = parseFloat(lng);
    }
    
    // 숫자가 아닌 경우 체크
    if (typeof lat !== 'number' || typeof lng !== 'number') {
        console.warn('좌표가 숫자 타입이 아님:', { lat: typeof lat, lng: typeof lng });
        return false;
    }
    
    // NaN 체크
    if (isNaN(lat) || isNaN(lng)) {
        console.warn('좌표가 NaN입니다:', { lat, lng });
        return false;
    }
    
    // 무한대 체크
    if (!isFinite(lat) || !isFinite(lng)) {
        console.warn('좌표가 무한대입니다:', { lat, lng });
        return false;
    }
    
    // 범위 체크 (위도: -90~90, 경도: -180~180)
    if (lat < -90 || lat > 90) {
        console.warn('위도가 유효 범위를 벗어남:', lat);
        return false;
    }
    
    if (lng < -180 || lng > 180) {
        console.warn('경도가 유효 범위를 벗어남:', lng);
        return false;
    }
    
    return true;
};

// 두 좌표 사이의 거리 계산 (미터 단위) - 안전한 버전
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
    try {
        // 입력값 검증
        const coords = [
            { latitude: lat1, longitude: lon1 },
            { latitude: lat2, longitude: lon2 }
        ];
        
        for (let i = 0; i < coords.length; i++) {
            if (!isValidLatLng(coords[i])) {
                console.error(`좌표 ${i + 1}이 유효하지 않음:`, coords[i]);
                return NaN;
            }
        }
        
        // 타입 변환
        const φ1 = (parseFloat(lat1) * Math.PI) / 180;
        const φ2 = (parseFloat(lat2) * Math.PI) / 180;
        const Δφ = ((parseFloat(lat2) - parseFloat(lat1)) * Math.PI) / 180;
        const Δλ = ((parseFloat(lon2) - parseFloat(lon1)) * Math.PI) / 180;

        const a = 
            Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        
        const R = 6371e3; // 지구 반지름 (미터)
        const distance = R * c;
        
        // 결과 검증
        if (isNaN(distance) || !isFinite(distance)) {
            console.error('거리 계산 결과가 유효하지 않음:', distance);
            return NaN;
        }
        
        return distance;
    } catch (error) {
        console.error('거리 계산 중 오류 발생:', error);
        return NaN;
    }
};

// 특정 좌표에서 다른 좌표를 향한 방향 계산 (각도) - 안전한 버전
export const calculateBearing = (lat1, lon1, lat2, lon2) => {
    try {
        // 입력값 검증
        const coords = [
            { latitude: lat1, longitude: lon1 },
            { latitude: lat2, longitude: lon2 }
        ];
        
        for (let i = 0; i < coords.length; i++) {
            if (!isValidLatLng(coords[i])) {
                console.error(`좌표 ${i + 1}이 유효하지 않음:`, coords[i]);
                return NaN;
            }
        }
        
        const φ1 = (parseFloat(lat1) * Math.PI) / 180;
        const φ2 = (parseFloat(lat2) * Math.PI) / 180;
        const Δλ = ((parseFloat(lon2) - parseFloat(lon1)) * Math.PI) / 180;

        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
        const θ = Math.atan2(y, x);
        
        const bearing = (θ * 180 / Math.PI + 360) % 360; // 0-359도로 변환
        
        // 결과 검증
        if (isNaN(bearing) || !isFinite(bearing)) {
            console.error('방향 계산 결과가 유효하지 않음:', bearing);
            return NaN;
        }
        
        return bearing;
    } catch (error) {
        console.error('방향 계산 중 오류 발생:', error);
        return NaN;
    }
};

// 절대 방향 각도를 쉬운 방향 표현으로 변환 (동서남북)
export const getDirectionFromBearing = (bearing) => {
    if (isNaN(bearing) || !isFinite(bearing)) {
        return '알 수 없음';
    }
    
    const directions = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
};

// 현재 이동 방향 대비 상대적 방향 계산 (시각 장애인용 핵심 기능)
export const getRelativeDirection = (currentBearing, targetBearing) => {
    if (isNaN(currentBearing) || isNaN(targetBearing) || 
        !isFinite(currentBearing) || !isFinite(targetBearing)) {
        return { direction: '알 수 없음', angle: 0, description: '방향을 알 수 없습니다' };
    }

    // 각도 차이 계산 (-180 ~ 180도 범위로 정규화)
    let angleDiff = targetBearing - currentBearing;
    if (angleDiff > 180) angleDiff -= 360;
    if (angleDiff < -180) angleDiff += 360;

    const absAngle = Math.abs(angleDiff);
    let direction = '';
    let description = '';

    if (absAngle <= 10) {
        direction = '직진';
        description = '계속 직진하세요';
    } else if (absAngle <= 45) {
        if (angleDiff > 0) {
            direction = '약간 오른쪽';
            description = '약간 오른쪽으로 방향을 조정하세요';
        } else {
            direction = '약간 왼쪽';
            description = '약간 왼쪽으로 방향을 조정하세요';
        }
    } else if (absAngle <= 90) {
        if (angleDiff > 0) {
            direction = '오른쪽';
            description = '오른쪽으로 돌아서 이동하세요';
        } else {
            direction = '왼쪽';
            description = '왼쪽으로 돌아서 이동하세요';
        }
    } else if (absAngle <= 135) {
        if (angleDiff > 0) {
            direction = '뒤쪽 오른쪽';
            description = '뒤쪽 오른쪽으로 크게 돌아서 이동하세요';
        } else {
            direction = '뒤쪽 왼쪽';
            description = '뒤쪽 왼쪽으로 크게 돌아서 이동하세요';
        }
    } else {
        direction = '뒤쪽';
        description = '뒤쪽으로 돌아서 이동하세요';
    }

    return {
        direction,
        angle: Math.round(angleDiff),
        absAngle: Math.round(absAngle),
        description
    };
};

// 사용자 이동 방향 계산 (최근 이동 경로 기반)
export const calculateUserMovingDirection = (locationHistory) => {
    if (!Array.isArray(locationHistory) || locationHistory.length < 2) {
        return null;
    }

    // 최근 3개 위치를 사용하여 이동 방향 계산 (더 안정적)
    const recentLocations = locationHistory.slice(-3);
    const bearings = [];

    for (let i = 0; i < recentLocations.length - 1; i++) {
        const bearing = calculateBearing(
            recentLocations[i].latitude,
            recentLocations[i].longitude,
            recentLocations[i + 1].latitude,
            recentLocations[i + 1].longitude
        );
        if (!isNaN(bearing)) {
            bearings.push(bearing);
        }
    }

    if (bearings.length === 0) return null;

    // 평균 방향 계산 (원형 평균)
    let sinSum = 0;
    let cosSum = 0;
    
    bearings.forEach(bearing => {
        const radians = bearing * Math.PI / 180;
        sinSum += Math.sin(radians);
        cosSum += Math.cos(radians);
    });

    const avgRadians = Math.atan2(sinSum, cosSum);
    const avgBearing = (avgRadians * 180 / Math.PI + 360) % 360;

    return avgBearing;
};

// 상대적 방향 안내 생성 (시각 장애인용 메인 함수)
export const generateRelativeDirectionGuidance = (currentPosition, targetPosition, locationHistory = []) => {
    try {
        if (!isValidLatLng(currentPosition) || !isValidLatLng(targetPosition)) {
            return {
                direction: '알 수 없음',
                description: '위치 정보를 확인할 수 없습니다',
                distance: 0
            };
        }

        // 목표 지점까지의 거리 계산
        const distance = calculateDistance(
            currentPosition.latitude,
            currentPosition.longitude,
            targetPosition.latitude,
            targetPosition.longitude
        );

        // 목표 지점의 절대 방향 계산
        const targetBearing = calculateBearing(
            currentPosition.latitude,
            currentPosition.longitude,
            targetPosition.latitude,
            targetPosition.longitude
        );

        if (isNaN(targetBearing) || isNaN(distance)) {
            return {
                direction: '알 수 없음',
                description: '방향을 계산할 수 없습니다',
                distance: 0
            };
        }

        // 사용자의 현재 이동 방향 계산
        const userBearing = calculateUserMovingDirection(locationHistory);
        
        let relativeInfo;
        if (userBearing !== null && !isNaN(userBearing)) {
            // 이동 중인 경우 - 상대적 방향 제공
            relativeInfo = getRelativeDirection(userBearing, targetBearing);
        } else {
            // 정지 상태이거나 이동 방향을 알 수 없는 경우 - 절대 방향 제공
            const absoluteDirection = getDirectionFromBearing(targetBearing);
            relativeInfo = {
                direction: absoluteDirection,
                description: `${absoluteDirection} 방향으로 이동하세요`,
                angle: 0,
                isAbsolute: true
            };
        }

        // 거리에 따른 상세 안내
        let distanceDescription = '';
        if (distance < 5) {
            distanceDescription = '바로 앞에 있습니다';
        } else if (distance < 20) {
            distanceDescription = `약 ${Math.round(distance)}미터 앞에 있습니다`;
        } else if (distance < 100) {
            distanceDescription = `약 ${Math.round(distance / 10) * 10}미터 이동하세요`;
        } else {
            distanceDescription = `약 ${Math.round(distance)}미터 이동하세요`;
        }

        return {
            direction: relativeInfo.direction,
            description: `${relativeInfo.description}. ${distanceDescription}`,
            distance: Math.round(distance),
            angle: relativeInfo.angle || 0,
            absAngle: relativeInfo.absAngle || 0,
            isAbsolute: relativeInfo.isAbsolute || false,
            targetBearing: Math.round(targetBearing),
            userBearing: userBearing ? Math.round(userBearing) : null
        };
    } catch (error) {
        console.error('상대적 방향 안내 생성 중 오류:', error);
        return {
            direction: '알 수 없음',
            description: '방향 안내를 생성할 수 없습니다',
            distance: 0
        };
    }
};

// 턴 타입을 상대적 방향으로 변환
export const getTurnInstruction = (turnType, distance = 0) => {
    const distanceText = distance > 0 ? ` ${Math.round(distance)}미터` : '';
    
    switch (turnType) {
        case 11: // 직진
            return `직진으로${distanceText} 이동하세요`;
        case 12: // 좌회전
            return `왼쪽으로 돌아서${distanceText} 이동하세요`;
        case 13: // 우회전
            return `오른쪽으로 돌아서${distanceText} 이동하세요`;
        case 14: // U턴
            return `뒤쪽으로 돌아서${distanceText} 이동하세요`;
        case 125: // 육교
            return `앞에 육교가 있습니다. 육교를 이용하여${distanceText} 이동하세요`;
        case 126: // 지하도
            return `앞에 지하도가 있습니다. 지하도를 이용하여${distanceText} 이동하세요`;
        case 127: // 계단
            return `앞에 계단이 있습니다. 계단을 이용하여${distanceText} 이동하세요`;
        case 128: // 경사로
            return `앞에 경사로가 있습니다. 경사로를 이용하여${distanceText} 이동하세요`;
        case 211:
        case 212:
        case 213: // 횡단보도
            return `앞에 횡단보도가 있습니다. 횡단보도를 건너서${distanceText} 이동하세요`;
        case 200: // 출발
            return '출발지입니다';
        case 201: // 도착
            return '목적지에 도착했습니다';
        default:
            return distanceText ? `${distanceText} 이동하세요` : '계속 이동하세요';
    }
};

// 네이버 지도 전용 좌표 포맷 변환 함수 (강화된 버전)
export const formatCoordinate = (coord) => {
    if (!coord) {
        console.warn('formatCoordinate: 좌표가 null 또는 undefined');
        return null;
    }
    
    try {
        // 배열인 경우 첫 번째 요소 선택
        const targetCoord = Array.isArray(coord) ? coord[0] : coord;
        if (!targetCoord) {
            console.error('배열에서 유효한 좌표를 찾을 수 없음:', coord);
            return null;
        }

        // 좌표 속성 확인
        if (!('latitude' in targetCoord) || !('longitude' in targetCoord)) {
            console.error('좌표에 latitude 또는 longitude 속성이 없음:', targetCoord);
            return null;
        }

        // 숫자 변환 및 검증
        let lat = targetCoord.latitude;
        let lng = targetCoord.longitude;
        
        // 문자열을 숫자로 변환
        if (typeof lat === 'string') {
            lat = parseFloat(lat);
        }
        if (typeof lng === 'string') {
            lng = parseFloat(lng);
        }
        
        // NaN 및 무한대 체크
        if (isNaN(lat) || isNaN(lng) || !isFinite(lat) || !isFinite(lng)) {
            console.error('좌표 변환 실패 - NaN 또는 무한대:', { 
                originalLat: targetCoord.latitude, 
                originalLng: targetCoord.longitude,
                convertedLat: lat,
                convertedLng: lng
            });
            return null;
        }
        
        // 범위 체크
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            console.error('좌표가 유효 범위를 벗어남:', { latitude: lat, longitude: lng });
            return null;
        }
        
        // 정밀도 조정 (소수점 6자리까지)
        const formattedCoord = {
            latitude: Number(parseFloat(lat).toFixed(6)),
            longitude: Number(parseFloat(lng).toFixed(6))
        };
        
        // 최종 검증
        if (!isValidLatLng(formattedCoord)) {
            console.error('최종 검증 실패:', formattedCoord);
            return null;
        }
        
        return formattedCoord;
    } catch (error) {
        console.error('좌표 포맷 변환 중 오류 발생:', error);
        return null;
    }
};

// 좌표 배열 검증 함수
export const validateCoordinateArray = (coordArray) => {
    if (!Array.isArray(coordArray)) {
        console.warn('좌표 배열이 배열이 아님:', coordArray);
        return [];
    }
    
    const validatedArray = coordArray
        .map((coord, index) => {
            const formatted = formatCoordinate(coord);
            if (!formatted) {
                console.warn(`배열 인덱스 ${index}의 좌표가 유효하지 않음:`, coord);
                return null;
            }
            return formatted;
        })
        .filter(coord => coord !== null);
    
    console.log(`좌표 배열 검증: ${coordArray.length}개 -> ${validatedArray.length}개 유효`);
    return validatedArray;
};

// 기본 위치 (부산)
export const DEFAULT_LOCATION = {
    latitude: 35.1796,
    longitude: 129.0756
};

// 좌표가 특정 경로와 근접한지 확인하는 함수
export const isCoordinateNearPath = (coord, pathCoord, threshold = 0.0001) => {
    if (!isValidLatLng(coord) || !isValidLatLng(pathCoord)) {
        return false;
    }
    
    const distance = Math.abs(coord.latitude - pathCoord.latitude) + 
                    Math.abs(coord.longitude - pathCoord.longitude);
    
    return distance <= threshold;
};

// 좌표 디버깅 정보 출력
export const debugCoordinate = (coord, label = '좌표') => {
    console.log(`=== ${label} 디버깅 정보 ===`);
    console.log('원본 데이터:', JSON.stringify(coord));
    console.log('타입:', typeof coord);
    console.log('배열 여부:', Array.isArray(coord));
    
    if (coord) {
        console.log('속성들:', Object.keys(coord));
        if ('latitude' in coord) {
            console.log('latitude:', coord.latitude, '(타입:', typeof coord.latitude, ')');
        }
        if ('longitude' in coord) {
            console.log('longitude:', coord.longitude, '(타입:', typeof coord.longitude, ')');
        }
    }
    
    const isValid = isValidLatLng(coord);
    const formatted = formatCoordinate(coord);
    
    console.log('유효성:', isValid);
    console.log('포맷된 결과:', formatted);
    console.log('========================');
    
    return { isValid, formatted };
};