import axios from 'axios';
import { TMAP_APP_KEY } from '@env';

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
        const response = await axios.get('https://apis.openapi.sk.com/tmap/pois', { params });

        console.log('Tmap POI API 응답:', JSON.stringify(response.data, null, 2));

        const poi = response.data.searchPoiInfo?.pois?.poi?.[0];
        if (!poi) {
            throw new Error(`"${query}"에 대한 좌표를 찾을 수 없습니다.`);
        }

        const longitude = parseFloat(poi.frontLon);
        const latitude = parseFloat(poi.frontLat);
        if (isNaN(longitude) || isNaN(latitude)) {
            throw new Error('좌표 형식이 잘못되었습니다.');
        }

        console.log(`POI 검색 성공 - ${query}:`, { longitude, latitude });
        return { longitude, latitude };
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

        const startX = start.longitude;
        const startY = start.latitude;
        const endX = goal.longitude;
        const endY = goal.latitude;

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
            }
        );

        console.log('Tmap Transit API 응답:', JSON.stringify(response.data, null, 2));

        const itinerary = response.data.metaData?.plan?.itineraries?.[0];
        if (!itinerary || !itinerary.legs) {
            throw new Error('유효한 대중교통 경로 데이터가 없습니다.');
        }

        const formattedRoute = [];
        const navigationInstructions = [];

        itinerary.legs.forEach((leg, index) => {
            console.log(`Leg ${index} - mode: ${leg.mode}, start: ${leg.start.name}, end: ${leg.end.name}`);

            if (leg.mode === 'WALK' && leg.steps && Array.isArray(leg.steps)) {
                leg.steps.forEach((step, stepIndex) => {
                    if (!step.linestring) {
                        console.warn(`Step ${stepIndex}에 linestring이 없습니다:`, step);
                        return;
                    }
                    console.log(`Step ${stepIndex} linestring:`, step.linestring);
                    const coords = step.linestring.split(' ').map(coord => {
                        const [longitude, latitude] = coord.split(',').map(Number);
                        if (isNaN(longitude) || isNaN(latitude)) {
                            console.warn(`Step ${stepIndex} 잘못된 좌표 형식:`, coord);
                            return null;
                        }
                        return { latitude, longitude };
                    }).filter(coord => coord !== null);

                    if (coords.length > 0) {
                        formattedRoute.push(...coords);
                    }

                    if (step.description.includes('횡단보도')) {
                        navigationInstructions.push({
                            type: 'crosswalk',
                            description: step.description,
                            position: coords[0] || { latitude: leg.start.lat, longitude: leg.start.lon },
                        });
                    }
                });
            } else if ((leg.mode === 'BUS' || leg.mode === 'SUBWAY') && leg.passShape && leg.passShape.linestring) {
                console.log(`PassShape linestring for ${leg.mode}:`, leg.passShape.linestring);
                const coords = leg.passShape.linestring.split(' ').map(coord => {
                    const [longitude, latitude] = coord.split(',').map(Number);
                    if (isNaN(longitude) || isNaN(latitude)) {
                        console.warn(`PassShape ${leg.mode} 잘못된 좌표 형식:`, coord);
                        return null;
                    }
                    return { latitude, longitude };
                }).filter(coord => coord !== null);

                if (coords.length > 0) {
                    formattedRoute.push(...coords);
                }

                navigationInstructions.push({
                    type: leg.mode.toLowerCase(),
                    description: `${leg.route} ${leg.mode === 'BUS' ? '버스' : '지하철'} 탑승`,
                    position: { latitude: leg.start.lat, longitude: leg.start.lon },
                });
            }
        });

        if (formattedRoute.length < 2) {
            console.warn('포맷된 경로 좌표가 2개 미만입니다:', formattedRoute);
            throw new Error('경로 좌표가 부족합니다.');
        }

        console.log('포맷된 대중교통 경로:', formattedRoute);
        console.log('내비게이션 안내 정보:', navigationInstructions);
        return { formattedRoute, navigationInstructions };
    } catch (error) {
        console.error('Tmap Transit API 호출 오류:', error.response ? error.response.data : error.message);
        throw error;
    }
};

export const getPedestrianDirections = async (start, goal) => {
    try {
        if (!TMAP_APP_KEY) {
            throw new Error('TMAP_APP_KEY가 .env에서 로드되지 않았습니다.');
        }

        const startX = start.longitude;
        const startY = start.latitude;
        const endX = goal.longitude;
        const endY = goal.latitude;

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
            }
        );

        console.log('Tmap Pedestrian API 응답:', JSON.stringify(response.data, null, 2));

        const features = response.data.features;
        if (!features || features.length === 0) {
            throw new Error('유효한 보행자 경로 데이터가 없습니다.');
        }

        const formattedRoute = [];
        const navigationInstructions = [];

        features.forEach((feature, index) => {
            if (feature.geometry.type === 'LineString') {
                const coords = feature.geometry.coordinates.map(([longitude, latitude]) => {
                    if (isNaN(longitude) || isNaN(latitude)) {
                        console.warn(`Feature ${index} 잘못된 좌표 형식:`, [longitude, latitude]);
                        return null;
                    }
                    return { latitude, longitude };
                }).filter(coord => coord !== null);

                if (coords.length > 0) {
                    formattedRoute.push(...coords);
                }
            }

            if (feature.properties.description?.includes('횡단보도')) {
                const coord = feature.geometry.coordinates[0];
                navigationInstructions.push({
                    type: 'crosswalk',
                    description: feature.properties.description,
                    position: { latitude: coord[1], longitude: coord[0] },
                });
            }
        });

        if (formattedRoute.length < 2) {
            console.warn('포맷된 보행자 경로 좌표가 2개 미만입니다:', formattedRoute);
            throw new Error('보행자 경로 좌표가 부족합니다.');
        }

        console.log('포맷된 보행자 경로:', formattedRoute);
        console.log('내비게이션 안내 정보:', navigationInstructions);
        return { formattedRoute, navigationInstructions };
    } catch (error) {
        console.error('Tmap Pedestrian API 호출 오류:', error.response ? error.response.data : error.message);
        throw error;
    }
};