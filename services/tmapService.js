import axios from 'axios';
import { TMAP_APP_KEY } from '@env';
import { calculateDistance, isValidLatLng } from '../utils/locationUtils';

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

// 보행자 경로 조회
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
        const instructions = [];

        features.forEach(feature => {
            const { geometry, properties } = feature;

            // 경로 좌표 추출
            if (geometry.type === 'LineString') {
                geometry.coordinates.forEach(([longitude, latitude]) => {
                    if (!isNaN(longitude) && !isNaN(latitude)) {
                        walkRoute.push({ latitude, longitude });
                    }
                });
            }

            // 안내 정보 추출
            if (geometry.type === 'Point' && properties) {
                const [longitude, latitude] = geometry.coordinates;
                const turnType = properties.turnType || 0;
                
                let type = getInstructionType(turnType);
                
                instructions.push({
                    type,
                    turnType,
                    description: properties.description || '',
                    position: { latitude, longitude },
                    distance: properties.distance || 0,
                    time: properties.time || 0,
                });
            }
        });

        return {
            route: {
                walk: walkRoute,
                subway: [],
                bus: []
            },
            instructions
        };
    } catch (error) {
        console.error('보행자 경로 조회 오류:', error.message);
        throw error;
    }
};

// 대중교통 경로 조회
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
                count: 1,
                lang: 0,
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

        // 출발지 안내
        instructions.push({
            type: 'start',
            description: '출발지입니다.',
            position: start,
            turnType: 200
        });

        // 각 구간 처리
        itinerary.legs.forEach(leg => {
            if (leg.mode === 'WALK' && leg.steps) {
                leg.steps.forEach(step => {
                    if (step.linestring) {
                        const coords = parseLinestring(step.linestring);
                        walkRoute.push(...coords);
                        
                        if (coords.length > 0) {
                            instructions.push({
                                type: 'direction',
                                description: step.description || `${step.distance}m 이동`,
                                position: coords[0],
                                distance: step.distance || 0
                            });
                        }
                    }
                });
            } else if (leg.mode === 'SUBWAY' && leg.passShape?.linestring) {
                const coords = parseLinestring(leg.passShape.linestring);
                subwayRoute.push(...coords);
                
                if (leg.start) {
                    instructions.push({
                        type: 'subway',
                        description: `${leg.route} 지하철 탑승`,
                        position: {
                            latitude: parseFloat(leg.start.lat),
                            longitude: parseFloat(leg.start.lon)
                        }
                    });
                }
            } else if (leg.mode === 'BUS' && leg.passShape?.linestring) {
                const coords = parseLinestring(leg.passShape.linestring);
                busRoute.push(...coords);
                
                if (leg.start) {
                    instructions.push({
                        type: 'bus',
                        description: `${leg.route} 버스 탑승`,
                        position: {
                            latitude: parseFloat(leg.start.lat),
                            longitude: parseFloat(leg.start.lon)
                        }
                    });
                }
            }
        });

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
            instructions
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

        // 100m 이하는 도보, 이상은 대중교통 우선
        if (distance <= 100) {
            return await getPedestrianDirections(start, goal);
        } else {
            try {
                return await getTransitDirections(start, goal);
            } catch (error) {
                // 대중교통 실패시 도보로 대체
                console.warn('대중교통 경로 실패, 도보 경로로 대체');
                return await getPedestrianDirections(start, goal);
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