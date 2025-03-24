// 좌표가 유효한지 확인하는 함수
export const isValidLatLng = (coord) => {
    if (!coord) return false;
    
    // 객체 형식 확인
    if (typeof coord !== 'object') return false;
    
    // 필수 속성 확인
    if (!('latitude' in coord) || !('longitude' in coord)) return false;
    
    // 값 검증
    const lat = Number(coord.latitude);
    const lng = Number(coord.longitude);
    
    // NaN 체크 및 범위 체크
    if (isNaN(lat) || isNaN(lng)) return false;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
    
    return true;
};

// 두 좌표 사이의 거리 계산 (미터 단위)
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // 지구 반지름 (미터)
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

// 특정 좌표에서 다른 좌표를 향한 방향 계산 (각도)
export const calculateBearing = (lat1, lon1, lat2, lon2) => {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
        Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);

    return (θ * 180 / Math.PI + 360) % 360; // 0-359도로 변환
};

// 방향 각도를 쉬운 방향 표현으로 변환
export const getDirectionFromBearing = (bearing) => {
    const directions = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
};

// 네이버 지도 전용 좌표 포맷 변환 함수
export const formatCoordinate = (coord) => {
    if (!coord) return null;
    
    try {
        // 숫자 변환 및 검증
        const lat = typeof coord.latitude === 'number' ? coord.latitude : Number(coord.latitude);
        const lng = typeof coord.longitude === 'number' ? coord.longitude : Number(coord.longitude);
        
        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return null;
        }
        
        // NaverMap이 기대하는 정확한 형식으로 반환
        return {
            latitude: Number(lat.toFixed(6)),
            longitude: Number(lng.toFixed(6))
        };
    } catch (e) {
        console.log('좌표 포맷 변환 오류:', e);
        return null;
    }
};