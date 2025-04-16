import axios from 'axios';
import { NAVER_MAP_CLIENT_ID, NAVER_MAP_CLIENT_SECRET } from '@env';

export const getDirections = async (start, goal, options = {}) => {
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
        
        // 옵션 설정 (기본값: trafast)
        const routeOption = options.routeOption || 'trafast';
        // 보행자 모드 여부
        const isWalking = options.isWalking || false;
        // 상세 정보 포함 여부
        const includeDetails = options.includeDetails || false;
        
        const queryParams = new URLSearchParams({
            start: startCoords,
            goal: goalCoords,
            option: isWalking ? 'tracomfort' : routeOption, // 보행자는 tracomfort 사용
            lang: 'ko'
        });

        const response = await axios.get(`${url}?${queryParams.toString()}`, {
            headers: {
                'X-NCP-APIGW-API-KEY-ID': NAVER_MAP_CLIENT_ID,
                'X-NCP-APIGW-API-KEY': NAVER_MAP_CLIENT_SECRET,
            },
        });

        console.log(`Naver ${isWalking ? '보행자' : ''} 경로 API 응답 수신 완료`);

        // 경로 데이터 추출 (trafast, tracomfort, traoptimal 등에 따라 다름)
        const routeData = response.data.route?.[routeOption]?.[0] || 
                         response.data.route?.traoptimal?.[0] ||
                         response.data.route?.tracomfort?.[0];
                         
        if (!routeData || !routeData.path) {
            throw new Error('유효한 경로 데이터가 없습니다.');
        }

        // 경로 좌표 포맷팅
        const formattedPath = routeData.path.map(([longitude, latitude]) => {
            if (isNaN(longitude) || isNaN(latitude)) {
                console.warn('잘못된 좌표 형식:', [longitude, latitude]);
                return null;
            }
            return { latitude, longitude };
        }).filter(coord => coord !== null);

        if (formattedPath.length < 2) {
            console.warn('포맷된 경로 좌표가 2개 미만입니다:', formattedPath);
            throw new Error('경로 좌표가 부족합니다.');
        }

        // 상세 정보를 요청하지 않은 경우 경로만 반환
        if (!includeDetails) {
            console.log('포맷된 경로:', formattedPath.length, '개 좌표');
            return formattedPath;
        }

        // 안내 정보 추출 및 보행자에 맞게 정보 가공
        const guides = routeData.guide?.map(guide => {
            // 보행자 안내에 적합하도록 메시지 수정
            let instructions = guide.instructions || '';
            
            if (isWalking) {
                // 보행자 모드인 경우 자동차 관련 안내 문구 변경
                instructions = instructions
                    .replace(/차선/g, '길')
                    .replace(/진입/g, '이동')
                    .replace(/도로/g, '경로')
                    .replace(/진출/g, '나가기')
                    .replace(/\d+번국도/g, '도로');
            }
            
            // 안내 타입 처리
            let type = guide.type;
            // 타입 변환 (자동차 경로 안내를 보행자용으로)
            if (isWalking && type === "POINT") {
                if (instructions.includes('횡단보도')) {
                    type = 'CROSSWALK';
                } else if (instructions.includes('좌회전')) {
                    type = 'LEFT';
                } else if (instructions.includes('우회전')) {
                    type = 'RIGHT';
                } else if (instructions.includes('직진')) {
                    type = 'STRAIGHT';
                }
            }
            
            return {
                pointIndex: guide.pointIndex,
                type: type,
                name: guide.name,
                distance: guide.distance,
                // 보행자는 더 느리게 이동하므로 시간 조정 (약 3~4배)
                duration: isWalking && guide.duration ? Math.round(guide.duration * 4) : guide.duration,
                instructions: instructions,
                direction: guide.direction || 0,
                roadIndex: guide.roadIndex,
                position: formattedPath[guide.pointIndex]
            };
        }) || [];
        
        // 목적지 정보 추가 (없을 경우)
        if (isWalking && guides.length > 0 && guides[guides.length - 1].pointIndex !== formattedPath.length - 1) {
            guides.push({
                pointIndex: formattedPath.length - 1,
                type: 'DESTINATION',
                name: '목적지',
                distance: 0,
                duration: 0,
                instructions: '목적지에 도착했습니다.',
                direction: 0,
                position: formattedPath[formattedPath.length - 1]
            });
        }
        
        // 요약 정보 추출 및 보행자에 맞게 수정
        const summary = {
            distance: routeData.summary.distance,
            // 보행자 시간 조정 (약 3~4배)
            duration: isWalking && routeData.summary.duration 
                ? Math.round(routeData.summary.duration * 4) 
                : routeData.summary.duration,
            start: {
                location: {
                    longitude: routeData.summary.start.location[0],
                    latitude: routeData.summary.start.location[1]
                }
            },
            goal: {
                location: {
                    longitude: routeData.summary.goal.location[0],
                    latitude: routeData.summary.goal.location[1]
                },
                dir: routeData.summary.goal.dir || 0
            }
        };
        
        console.log(`포맷된 ${isWalking ? '보행자' : ''} 경로:`, formattedPath.length, '개 좌표,', 
                    guides.length, '개 안내');
        
        return {
            path: formattedPath,
            guides: guides,
            summary: summary
        };
    } catch (error) {
        console.error('Directions API 호출 오류:', error.response ? error.response.data : error.message);
        throw error;
    }
};