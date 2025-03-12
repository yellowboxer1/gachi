import * as Location from 'expo-location';
import * as Speech from 'expo-speech';

export const isValidLatLng = (location) => {
    return (
        location &&
        typeof location.latitude === 'number' &&
        typeof location.longitude === 'number' &&
        !isNaN(location.latitude) &&
        !isNaN(location.longitude) &&
        location.latitude >= -90 &&
        location.latitude <= 90 &&
        location.longitude >= -180 &&
        location.longitude <= 180
    );
};

export const initializeLocation = async (setUserLocation) => {
    try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        console.log('위치 권한 상태:', status);
        if (status !== 'granted') {
            Speech.speak('위치 권한이 필요합니다.', { language: 'ko-KR' });
            return;
        }

        let location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
            timeout: 15000,
            maximumAge: 10000,
        });

        console.log('받아온 위치 정보:', location.coords);
        const userPos = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
        };

        if (isValidLatLng(userPos)) {
            setUserLocation(userPos);
        } else {
            console.error('유효하지 않은 위치:', userPos);
            Speech.speak('유효하지 않은 위치 정보입니다.', { language: 'ko-KR' });
        }
    } catch (error) {
        console.error('위치 정보 오류 상세:', error);
        Speech.speak('위치 정보를 가져오는 데 실패했습니다.', { language: 'ko-KR' });
    }
};