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

// 방향 각도를 쉬운 방향 표현으로 변환
export const getDirectionFromBearing = (bearing) => {
    if (isNaN(bearing) || !isFinite(bearing)) {
        return '알 수 없음';
    }
    
    const directions = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
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