import axios from 'axios';
import { TMAP_APP_KEY, ODSAY_API_KEY } from '@env';
import {
  calculateDistance,
  isValidLatLng,
  calculateBearing,
  getDirectionFromBearing,
} from '../utils/locationUtils';

/* ======================================
 * 1) POI 검색 (원본 그대로)
 * ====================================== */
export const getPoiCoordinates = async (query, userLocation = null) => {
  try {
    if (!TMAP_APP_KEY) throw new Error('TMAP_APP_KEY가 설정되지 않았습니다.');

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
    if (!pois || !Array.isArray(pois) || pois.length === 0) return [];

    const poiList = pois
      .map((poi) => {
        const latitude = parseFloat(poi.frontLat);
        const longitude = parseFloat(poi.frontLon);
        if (isNaN(latitude) || isNaN(longitude)) return null;
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
      })
      .filter((poi) => poi !== null);

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

/* ======================================
 * 2) 보행 상세 안내 유틸 (원본 유지)
 * ====================================== */
const generateDetailedWalkInstructions = (coordinates, startName = '출발지', endName = '도착지') => {
  if (!coordinates || coordinates.length < 2) return [];

  const instructions = [];
  // 출발지
  instructions.push({
    type: 'start',
    description: `${startName}에서 출발합니다.`,
    position: coordinates[0],
    distance: 0,
    turnType: 200,
  });

  // 방향 변화 감지
  for (let i = 1; i < coordinates.length - 1; i++) {
    const prev = coordinates[i - 1];
    const current = coordinates[i];
    const next = coordinates[i + 1];

    const prevBearing = calculateBearing(prev.latitude, prev.longitude, current.latitude, current.longitude);
    const nextBearing = calculateBearing(current.latitude, current.longitude, next.latitude, next.longitude);

    let angleDiff = nextBearing - prevBearing;
    if (angleDiff > 180) angleDiff -= 360;
    if (angleDiff < -180) angleDiff += 360;

    const distanceToNext = calculateDistance(current.latitude, current.longitude, next.latitude, next.longitude);

    if (Math.abs(angleDiff) > 30 || distanceToNext > 200) {
      let instruction = '';
      let turnType = 11; // 직진
      if (angleDiff > 45) {
        instruction = `우회전 후 ${Math.round(distanceToNext)}미터 직진하세요.`;
        turnType = 13;
      } else if (angleDiff < -45) {
        instruction = `좌회전 후 ${Math.round(distanceToNext)}미터 직진하세요.`;
        turnType = 12;
      } else if (Math.abs(angleDiff) > 15) {
        const direction = getDirectionFromBearing(nextBearing);
        instruction = `${direction} 방향으로 ${Math.round(distanceToNext)}미터 이동하세요.`;
      } else {
        instruction = `${Math.round(distanceToNext)}미터 직진하세요.`;
      }

      if (instruction) {
        instructions.push({
          type: 'direction',
          description: instruction,
          position: current,
          distance: Math.round(distanceToNext),
          turnType,
          bearing: nextBearing,
        });
      }
    }
  }

  // 목적지
  instructions.push({
    type: 'destination',
    description: `${endName}에 도착했습니다.`,
    position: coordinates[coordinates.length - 1],
    distance: 0,
    turnType: 201,
  });

  return instructions;
};

/* ======================================
 * 3) 보행 경로 (원본 그대로: Tmap 보행 API)
 * ====================================== */
export const getPedestrianDirections = async (start, goal) => {
  try {
    if (!TMAP_APP_KEY) throw new Error('TMAP_APP_KEY가 설정되지 않았습니다.');
    if (!isValidLatLng(start) || !isValidLatLng(goal)) throw new Error('유효하지 않은 좌표입니다.');

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
    if (!features || features.length === 0) throw new Error('경로 데이터가 없습니다.');

    const walkRoute = [];
    let totalDistance = 0;
    let totalTime = 0;

    features.forEach((feature) => {
      const { geometry, properties } = feature;

      if (geometry.type === 'LineString') {
        geometry.coordinates.forEach(([longitude, latitude]) => {
          if (!isNaN(longitude) && !isNaN(latitude)) {
            walkRoute.push({ latitude, longitude });
          }
        });
      }

      if (properties) {
        totalDistance += properties.distance || 0;
        totalTime += properties.time || 0;
      }
    });

    const instructions = generateDetailedWalkInstructions(walkRoute, '출발지', '목적지');

    return {
      route: { walk: walkRoute, subway: [], bus: [] },
      instructions,
      summary: {
        totalDistance: Math.round(totalDistance),
        totalTime: Math.round(totalTime / 60), // 분
        transportType: 'walk',
      },
    };
  } catch (error) {
    console.error('보행자 경로 조회 오류:', error.message);
    throw error;
  }
};

/* ======================================
 * 4) 대중교통 경로 (여기만 ODsay로 교체)
 *    - Tmap의 /transit/routes 호출 제거
 *    - ODsay subPath 중 도보(3)는 Tmap 보행 재계산으로 폴리라인 대체
 * ====================================== */
export const getTransitDirections = async (start, goal, { opt = 0 } = {}) => {
    try {
      if (!isValidLatLng(start) || !isValidLatLng(goal)) {
        throw new Error('유효하지 않은 좌표입니다.');
      }
      if (!ODSAY_API_KEY) {
        throw new Error('ODSAY_API_KEY가 설정되지 않았습니다.');
      }
  
      const url = 'https://api.odsay.com/v1/api/searchPubTransPathT';
      const params = {
        SX: String(start.longitude), // X=경도
        SY: String(start.latitude),  // Y=위도
        EX: String(goal.longitude),
        EY: String(goal.latitude),
        OPT: typeof opt === 'number' ? opt : 0, // 0=최단, 1=최소환승, 2=최소도보...
        output: 'json',
        apiKey: ODSAY_API_KEY,
      };
  
      // 디버깅 로그
      // console.log('[ODsay] params', params);
  
      const { data } = await axios.get(url, { params, timeout: 15000 });
  
      if (!data?.result?.path?.length) {
        const err = data?.error || data;
        throw new Error(`ODsay route error: ${JSON.stringify(err)}`);
      }
  
      const path = data.result.path[0];
      const info = path.info;
      const subPath = path.subPath || [];
  
      const walkRoute = [];
      const subwayRoute = [];
      const busRoute = [];
      const instructions = [];
  
      instructions.push({
        type: 'start',
        description: '출발지에서 대중교통 이용을 시작합니다.',
        position: start,
        turnType: 200,
      });
  
      for (const seg of subPath) {
        const t = seg.trafficType; // 1=지하철, 2=버스, 3=도보
        const segStart = seg.startX && seg.startY
          ? { latitude: parseFloat(seg.startY), longitude: parseFloat(seg.startX) }
          : start;
        const segEnd = seg.endX && seg.endY
          ? { latitude: parseFloat(seg.endY), longitude: parseFloat(seg.endX) }
          : goal;
  
        if (t === 3) {
          // 도보 구간은 Tmap 보행으로 폴리라인 재계산
          try {
            const walk = await getPedestrianDirections(segStart, segEnd);
            if (walk?.route?.walk?.length) walkRoute.push(...walk.route.walk);
            if (walk?.instructions?.length) {
              instructions.push(...walk.instructions.filter((i) => i.type !== 'start'));
            } else {
              instructions.push({
                type: 'walk',
                description: `${Math.round(seg.distance || 0)}미터 도보 이동하세요.`,
                position: segStart,
                distance: Math.round(seg.distance || 0),
              });
            }
          } catch {
            instructions.push({
              type: 'walk',
              description: `${Math.round(seg.distance || 0)}미터 도보 이동하세요.`,
              position: segStart,
              distance: Math.round(seg.distance || 0),
            });
          }
        } else if (t === 1) {
          const coords =
            seg.passStopList?.stations?.map((st) => ({
              latitude: parseFloat(st.y),
              longitude: parseFloat(st.x),
            })) || [];
          if (!coords.length) coords.push(segStart, segEnd);
          subwayRoute.push(...coords);
  
          const stationCount = seg.passStopList?.stations?.length || 0;
          instructions.push({
            type: 'subway',
            description: `${seg.lane?.[0]?.name || '지하철'}를 타고 ${seg.startName}에서 ${seg.endName}까지 이동하세요. (${stationCount}개 정거장, 약 ${seg.sectionTime || 0}분)`,
            position: segStart,
            routeName: seg.lane?.[0]?.name || '',
            startStation: seg.startName,
            endStation: seg.endName,
            stationCount,
            sectionTime: seg.sectionTime || 0,
          });
        } else if (t === 2) {
          const coords =
            seg.passStopList?.stations?.map((st) => ({
              latitude: parseFloat(st.y),
              longitude: parseFloat(st.x),
            })) || [];
          if (!coords.length) coords.push(segStart, segEnd);
          busRoute.push(...coords);
  
          const stationCount = seg.passStopList?.stations?.length || 0;
          const routeName = seg.lane?.[0]?.busNo || seg.lane?.[0]?.name || '버스';
          instructions.push({
            type: 'bus',
            description: `${routeName} 버스를 타고 ${seg.startName}에서 ${seg.endName}까지 이동하세요. (${stationCount}개 정거장, 약 ${seg.sectionTime || 0}분)`,
            position: segStart,
            routeName,
            startStation: seg.startName,
            endStation: seg.endName,
            stationCount,
            sectionTime: seg.sectionTime || 0,
          });
        }
      }
  
      instructions.push({
        type: 'destination',
        description: '목적지에 도착했습니다.',
        position: goal,
        turnType: 201,
      });
  
      return {
        route: { walk: walkRoute, subway: subwayRoute, bus: busRoute },
        instructions,
        summary: {
          totalDistance: Math.round(info?.totalDistance || 0),
          totalTime: Math.round(info?.totalTime || 0),
          totalCost: info?.payment ?? 0,
          transportType: 'transit',
        },
      };
    } catch (error) {
      console.error('대중교통 경로 조회 오류(ODsay):', error?.message || error);
      const walk = await getPedestrianDirections(start, goal);
      walk.fallbackReason = '대중교통 경로를 찾을 수 없어 도보 경로를 제공합니다.';
      return walk;
    }
  };  

/* ======================================
 * 5) 통합 경로 (거리에 따라 자동)
 *    - 500m 이하는 도보
 *    - 그 외 ODsay → 비효율 시 도보 대체
 * ====================================== */
export const getCombinedDirections = async (start, goal) => {
  if (!isValidLatLng(start) || !isValidLatLng(goal)) throw new Error('유효하지 않은 좌표입니다.');
  const distance = haversine(start.latitude, start.longitude, goal.latitude, goal.longitude);

  if (distance <= 500) {
    return getPedestrianDirections(start, goal);
  }

  try {
    const transit = await getTransitDirections(start, goal);
    const walkTime = distance / (4000 / 60); // 4km/h 기준 (분)
    if (transit?.summary?.totalTime > walkTime * 1.5) {
      const walk = await getPedestrianDirections(start, goal);
      walk.alternativeAvailable = true;
      walk.alternativeInfo = `대중교통 이용시 ${transit.summary.totalTime}분 소요`;
      return walk;
    }
    return transit;
  } catch (e) {
    const walk = await getPedestrianDirections(start, goal);
    walk.fallbackReason = '대중교통 경로 실패로 도보 경로를 제공합니다.';
    return walk;
  }
};

/* ======================================
 * 6) 기타 유틸
 * ====================================== */
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ======================================
 * 7) (선택) 실시간 버스 - Tmap 의존이므로 비활성/유지 선택
 *    - ODsay 전용 실시간 붙일 계획이면 별도 구현
 * ====================================== */
// 유지하려면 사용처에서만 호출하세요. (ODsay 전환 후엔 미사용을 권장)
const getBusStopInfo = async (stationId) => {
  try {
    const response = await axios.get('https://apis.openapi.sk.com/transit/bus/stations/arrival', {
      params: { stationId, appKey: TMAP_APP_KEY },
      timeout: 5000,
    });
    const arrivals = response.data?.result?.arrivalList || [];
    return arrivals.map((arrival) => ({
      routeName: arrival.routeName,
      remainingTime: arrival.remainingTime || 0,
      remainingStops: arrival.remainingStops || 0,
      direction: arrival.direction || '',
      vehicleType: arrival.vehicleType || 'bus',
    }));
  } catch (error) {
    console.warn('버스 정보 조회 실패:', error.message);
    return [];
  }
};

/* ======================================
 * 8) export (named + default 둘 다)
 *    - 기존 import 방식 `import * as tmapService` 유지 가능
 *    - Metro 캐시 이슈 시: `npx expo start -c`
 * ====================================== */
const api = {
  getPoiCoordinates,
  getPedestrianDirections,
  getTransitDirections,
  getCombinedDirections,
  // getBusStopInfo, // 필요 시 노출
};

export default api;
