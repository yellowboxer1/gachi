import axios from 'axios';
import { NAVER_MAP_CLIENT_ID, NAVER_MAP_CLIENT_SECRET } from '@env';

// 지역명을 추론하는 함수
const inferRegionFromLocation = (latitude, longitude) => {
    if (latitude >= 35 && latitude <= 36 && longitude >= 128 && longitude <= 130) {
        return '부산';
    } else if (latitude >= 37 && latitude <= 38 && longitude >= 126 && longitude <= 128) {
        return '서울';
    } else if (latitude >= 36 && latitude <= 37 && longitude >= 127 && longitude <= 128) {
        return '대전';
    }
    return '';
};

export const getDirections = async (start, goal) => {
    try {
        console.log('NAVER_MAP_CLIENT_ID:', NAVER_MAP_CLIENT_ID);
        console.log('NAVER_MAP_CLIENT_SECRET:', NAVER_MAP_CLIENT_SECRET);
        if (!NAVER_MAP_CLIENT_ID || !NAVER_MAP_CLIENT_SECRET) {
            throw new Error('네이버 API 키가 .env에서 로드되지 않았습니다.');
        }

        const startCoords = `${start.longitude},${start.latitude}`;
        const goalCoords = `${goal.longitude},${goal.latitude}`;

        console.log('Directions API 호출 - 시작:', startCoords, '목적지:', goalCoords);

        const url = 'https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving';
        const queryParams = new URLSearchParams({
            start: startCoords,
            goal: goalCoords,
            option: 'trafast',
        });

        const response = await axios.get(`${url}?${queryParams.toString()}`, {
            headers: {
                'X-NCP-APIGW-API-KEY-ID': NAVER_MAP_CLIENT_ID,
                'X-NCP-APIGW-API-KEY': NAVER_MAP_CLIENT_SECRET,
            },
        });

        console.log('Directions API 응답:', JSON.stringify(response.data, null, 2));

        const routeData = response.data.route?.traoptimal?.[0]?.path;
        if (!routeData || !Array.isArray(routeData)) {
            throw new Error('유효한 경로 데이터가 없습니다.');
        }

        const formattedRoute = routeData.map(([longitude, latitude]) => {
            if (isNaN(longitude) || isNaN(latitude)) {
                console.warn('잘못된 좌표 형식:', [longitude, latitude]);
                return null;
            }
            return { latitude, longitude };
        }).filter(coord => coord !== null);

        if (formattedRoute.length < 2) {
            console.warn('포맷된 경로 좌표가 2개 미만입니다:', formattedRoute);
            throw new Error('경로 좌표가 부족합니다.');
        }

        console.log('포맷된 경로:', formattedRoute);
        return formattedRoute;
    } catch (error) {
        console.error('Directions API 호출 오류:', error.response ? error.response.data : error.message);
        throw error;
    }
};

export const getCoordinates = async (query, userLocation = null) => {
    try {
        console.log('NAVER_MAP_CLIENT_ID:', NAVER_MAP_CLIENT_ID);
        console.log('NAVER_MAP_CLIENT_SECRET:', NAVER_MAP_CLIENT_SECRET);
        if (!NAVER_MAP_CLIENT_ID || !NAVER_MAP_CLIENT_SECRET) {
            throw new Error('네이버 API 키가 .env에서 로드되지 않았습니다.');
        }

        // 1차 시도: 원래 쿼리 그대로 호출
        console.log('Geocoding API 호출 - 쿼리 (1차):', query);
        let response = await axios.get(
            'https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode',
            {
                params: { query },
                headers: {
                    'X-NCP-APIGW-API-KEY-ID': NAVER_MAP_CLIENT_ID,
                    'X-NCP-APIGW-API-KEY': NAVER_MAP_CLIENT_SECRET,
                },
            }
        );

        console.log('네이버 Geocoding API 응답 (1차):', JSON.stringify(response.data, null, 2));

        if (response.data.addresses && response.data.addresses.length > 0) {
            const { x, y } = response.data.addresses[0];
            const longitude = parseFloat(x);
            const latitude = parseFloat(y);
            if (isNaN(longitude) || isNaN(latitude)) {
                throw new Error('좌표 형식이 잘못되었습니다.');
            }
            console.log(`Geocoding 성공 - ${query}:`, { longitude, latitude });
            return { longitude, latitude };
        }

        // 2차 시도: userLocation 기반 지역명 추가
        if (userLocation) {
            const region = inferRegionFromLocation(userLocation.latitude, userLocation.longitude);
            const enhancedQuery = region ? `${region} ${query}` : `${query}역`; // 지역명 또는 "역" 추가
            console.log('Geocoding API 호출 - 쿼리 (2차):', enhancedQuery);

            response = await axios.get(
                'https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode',
                {
                    params: { query: enhancedQuery },
                    headers: {
                        'X-NCP-APIGW-API-KEY-ID': NAVER_MAP_CLIENT_ID,
                        'X-NCP-APIGW-API-KEY': NAVER_MAP_CLIENT_SECRET,
                    },
                }
            );

            console.log('네이버 Geocoding API 응답 (2차):', JSON.stringify(response.data, null, 2));

            if (response.data.addresses && response.data.addresses.length > 0) {
                const { x, y } = response.data.addresses[0];
                const longitude = parseFloat(x);
                const latitude = parseFloat(y);
                if (isNaN(longitude) || isNaN(latitude)) {
                    throw new Error('좌표 형식이 잘못되었습니다.');
                }
                console.log(`Geocoding 성공 - ${enhancedQuery}:`, { longitude, latitude });
                return { longitude, latitude };
            }
        }

        // 실패 시 에러 메시지 변경
        console.warn('Geocoding 실패:', query);
        throw new Error(`목적지를 찾을 수 없습니다. 다시 말씀해주세요.`);
    } catch (error) {
        console.error('네이버 Geocoding API 호출 오류:', error.response ? error.response.data : error.message);
        throw error;
    }
};