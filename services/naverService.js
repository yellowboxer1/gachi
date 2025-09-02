// naverService.js
import Constants from 'expo-constants';

/** --------------------------------
 *  공통 유틸 / 환경변수
 * -------------------------------- */
const getExtra = (k) =>
  (typeof process !== 'undefined' && process.env?.[k]) ||
  Constants?.expoConfig?.extra?.[k] ||
  Constants?.manifest?.extra?.[k] || '';

const MAPS_ID = getExtra('NAVER_MAP_CLIENT_ID');        // x-ncp-apigw-api-key-id (NCP Maps Geocoding)
const MAPS_KEY = getExtra('NAVER_MAP_CLIENT_SECRET');   // x-ncp-apigw-api-key
const DEV_ID  = getExtra('NAVER_DEV_CLIENT_ID');        // X-Naver-Client-Id (Developers Local)
const DEV_KEY = getExtra('NAVER_DEV_CLIENT_SECRET');    // X-Naver-Client-Secret

const GEOCODE_URL = 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode';
const LOCAL_URL   = 'https://openapi.naver.com/v1/search/local.json';

const KM = 1000;
const NEAR_KM = 50;              // 이 거리 이내면 "근처 결과"로 인정

/** --------------------------------
 *  목업(우선 매칭) 사전
 *  - synonyms에 포함되면 무조건 이 좌표/주소를 사용
 *  - 사용자가 제공한 좌표/주소 그대로 반영
 * -------------------------------- */
const MOCK_POIS = [
  {
    name: '신세계백화점 센텀시티점',
    fullAddress: '부산 해운대구 센텀남대로 35',
    lat: 35.1688179,
    lon: 129.1295233,
    synonyms: ['신세계 센텀시티', '신세계 백화점', '신세계 백화점 센텀', '신세계백화점 센텀', '신세계백화점 센텀시티']
  },
  {
    name: '부산역(KTX)',
    fullAddress: '부산 동구 중앙대로 206',
    lat: 35.1176012,
    lon: 129.0450579,
    synonyms: ['부산역', '부산 역', '부산역 ktx', '부산역(KTX)']
  },
  {
    name: '해운대해수욕장',
    fullAddress: '부산 해운대구',
    lat: 35.159028,
    lon: 129.423056, // 요청값 그대로 사용
    synonyms: ['해운대', '해운대 해수욕장', '해운대해변']
  },
  {
    name: '센텀역(동해선)',
    fullAddress: '부산 해운대구 해운대로 210',
    lat: 35.1794753973039,
    lon: 129.124554780419,
    synonyms: ['센텀역', '센텀 역', '센텀(동해선)']
  },
  {
    name: '센텀시티역(2호선)',
    fullAddress: '부산 해운대구',
    lat: 35.1692784253147,
    lon: 129.13236458411,
    synonyms: ['센텀시티역', '센텀시티 역', '센텀시티(2호선)']
  },
  {
    name: '서울역(KTX)',
    fullAddress: '서울 용산구 한강대로 405',
    lat: 37.5548375992165,
    lon: 126.971732581232,
    synonyms: ['서울역', '서울 역', '서울역 ktx', '서울역(KTX)']
  },
];

/** 질의가 목업 사전에 해당하면 바로 반환 */
function tryMockMatch(query) {
  const q = (query || '').replace(/\s{2,}/g, ' ').trim().toLowerCase();
  for (const poi of MOCK_POIS) {
    if (poi.name.toLowerCase() === q) {
      return [{
        name: poi.name,
        fullAddress: poi.fullAddress,
        latitude: poi.lat,
        longitude: poi.lon,
      }];
    }
    if (poi.synonyms?.some(s => s.toLowerCase() === q)) {
      return [{
        name: poi.name,
        fullAddress: poi.fullAddress,
        latitude: poi.lat,
        longitude: poi.lon,
      }];
    }
  }
  return null;
}

/** --------------------------------
 *  좌표/거리 유틸
 * -------------------------------- */
function tm128ToWgs84Approx(x, y) {
  const lon = (x - 340000) / 2.5 / 3600 + 127;
  const lat = (y - 132000) / 2.5 / 3600 + 38;
  return { lat, lon };
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** --------------------------------
 *  문자열/파서 유틸
 * -------------------------------- */
function stripHtml(s = '') {
  return s.replace(/<[^>]+>/g, '');
}

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/** --------------------------------
 *  API 호출부
 * -------------------------------- */
async function geocodeByQuery(query) {
  const url = `${GEOCODE_URL}?query=${encodeURIComponent(query)}`;
  console.log('🔍 Geocode URL:', url);

  if (!MAPS_ID || !MAPS_KEY) {
    console.log('⚠️ Geocode 키 없음 (MAPS_ID/MAPS_KEY)');
    return [];
  }
  try {
    const res = await fetch(url, {
      headers: {
        'x-ncp-apigw-api-key-id': MAPS_ID,
        'x-ncp-apigw-api-key': MAPS_KEY,
        Accept: 'application/json',
      },
    });
    console.log('📡 Geocode status:', res.status);
    if (!res.ok) return [];

    const json = await res.json();
    const list = Array.isArray(json.addresses) ? json.addresses : [];
    return list
      .map((a) => {
        const lat = toNum(a.y);
        const lon = toNum(a.x);
        return Number.isFinite(lat) && Number.isFinite(lon)
          ? {
              name: stripHtml(a.roadAddress || a.jibunAddress || query),
              fullAddress: a.roadAddress || a.jibunAddress || '',
              lat,
              lon,
            }
          : null;
      })
      .filter(Boolean);
  } catch (e) {
    console.log('❌ Geocode error:', e?.message || e);
    return [];
  }
}

async function localSearch(query, display = 10) {
  const url = `${LOCAL_URL}?query=${encodeURIComponent(query)}&display=${display}`;
  console.log('🔍 Local URL:', url);

  if (!DEV_ID || !DEV_KEY) {
    console.log('⚠️ Local 키 없음 (DEV_ID/DEV_KEY)');
    return [];
  }
  try {
    const res = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': DEV_ID,
        'X-Naver-Client-Secret': DEV_KEY,
        Accept: 'application/json',
      },
    });
    console.log('📡 Local status:', res.status);
    if (!res.ok) return [];

    const json = await res.json();
    const items = Array.isArray(json.items) ? json.items : [];
    return items.map((it) => {
      const x = parseFloat(it.mapx); // TM128
      const y = parseFloat(it.mapy);
      let lat = NaN;
      let lon = NaN;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const conv = tm128ToWgs84Approx(x, y);
        lat = conv.lat;
        lon = conv.lon;
      }
      return {
        raw: it,
        name: stripHtml(it.title || ''),
        roadAddress: it.roadAddress || '',
        address: it.address || '',
        lat,
        lon,
      };
    });
  } catch (e) {
    console.log('❌ Local error:', e?.message || e);
    return [];
  }
}

/** 후보 하나를 Geocode로 좌표 보정(roadAddress 우선) */
async function refineCandidateCoords(cand) {
  const target = cand.roadAddress || cand.address || cand.name;
  if (!target) return cand;
  const g = await geocodeByQuery(target);
  if (g.length) {
    const best = g[0];
    return {
      ...cand,
      lat: best.lat,
      lon: best.lon,
      fullAddress: best.fullAddress || cand.roadAddress || cand.address || '',
    };
  }
  return cand;
}

/** --------------------------------
 *  메인: POI 검색
 *  - 1) 목업 우선 매칭 (즉시 반환)
 *  - 2) Local Search (+부산 바이어스)
 *  - 3) 후보 좌표 보정(필요 시 Geocode)
 *  - 4) 거리 필터(50km)
 *  - 5) Local 전무 시 Geocode 직접
 *  - 6) 최종 반환 / 필요 시 1순위 강매칭
 * -------------------------------- */
export async function getPoiCoordinates(query, center, opts = { chooseFirstIfNone: true }) {
  const q = (query || '').replace(/\s{2,}/g, ' ').trim();
  console.log('🔍 POI 검색 시작:', q);

  // 1) 목업 우선
  const mock = tryMockMatch(q);
  if (mock) {
    console.log('🏷️ 목업 히트 → 즉시 반환');
    return mock;
  }

  const centerLat = toNum(center?.latitude);
  const centerLon = toNum(center?.longitude);
  const hasCenter = Number.isFinite(centerLat) && Number.isFinite(centerLon);

  // 2) Local Search
  let locals = await localSearch(q, 10);

  // 지역 바이어스(질의에 광역 지명이 없고, 현재 중심 좌표가 있으면)
  if (hasCenter && !/부산|서울|대구|인천|광주|대전|울산|제주|경기|경남|경북|전남|전북|충남|충북|강원|세종/.test(q)) {
    const bias = `부산 ${q}`;
    console.log('🔁 지역 바이어스 재질의:', JSON.stringify(bias));
    const biased = await localSearch(bias, 10);
    const exist = new Set(locals.map((i) => i.name + '|' + i.roadAddress));
    biased.forEach((b) => {
      const key = b.name + '|' + b.roadAddress;
      if (!exist.has(key)) locals.push(b);
    });
  }

  // (보너스) Local 결과가 목업의 대표명/시소니믹스와 매치되면 해당 항목을 목업 좌표로 치환
  locals = locals.map((it) => {
    const t = it.name?.toLowerCase?.() || '';
    for (const poi of MOCK_POIS) {
      if (poi.name.toLowerCase() === t || poi.synonyms?.some(s => s.toLowerCase() === t)) {
        return {
          ...it,
          name: poi.name,
          roadAddress: poi.fullAddress,
          address: poi.fullAddress,
          lat: poi.lat,
          lon: poi.lon,
        };
      }
    }
    return it;
  });

  // 3) 좌표 보정 (너무 먼 좌표거나 좌표가 NaN이면 주소로 Geocode)
  const refined = [];
  for (const it of locals) {
    let cand = { ...it };
    let needRefine = false;

    if (hasCenter && Number.isFinite(cand.lat) && Number.isFinite(cand.lon)) {
      const d = haversine(centerLat, centerLon, cand.lat, cand.lon);
      console.log(`📏 '${cand.name}'까지 거리 ≈ ${(d / KM).toFixed(1)}km`);
      if (d > 3000 * KM) needRefine = true; // TM128 근사 오차 방어
    } else if (!Number.isFinite(cand.lat) || !Number.isFinite(cand.lon)) {
      needRefine = true;
    }

    if (needRefine && (cand.roadAddress || cand.address)) {
      cand = await refineCandidateCoords(cand);
    }
    refined.push(cand);
  }

  // 4) 유효 후보(좌표 보유)만 추리고 거리순 정렬 → 근처(50km) 우선
  let valid = refined.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon));
  if (hasCenter) {
    valid = valid
      .map(c => ({ ...c, _dist: haversine(centerLat, centerLon, c.lat, c.lon) }))
      .sort((a, b) => a._dist - b._dist);
  }
  let near = valid;
  if (hasCenter) near = valid.filter(c => c._dist <= NEAR_KM * KM);

  // 5) Local이 전혀 없으면 → Geocode 직접 시도(지명/주소 질의일 수 있음)
  if (!locals.length) {
    const byGeo = await geocodeByQuery(q);
    if (byGeo.length) {
      const list = byGeo.map((g) => ({
        name: g.name,
        fullAddress: g.fullAddress,
        latitude: g.lat,
        longitude: g.lon,
      }));
      console.log('✅ Geocode 직접 결과:', list.length, '개');
      return list;
    }
  }

  // 6) near → valid → (없으면) 1순위 강매칭
  let picked = near.length ? near : valid;

  if (!picked.length && locals.length && opts?.chooseFirstIfNone) {
    let first = locals[0];
    if (!Number.isFinite(first.lat) || !Number.isFinite(first.lon)) {
      first = await refineCandidateCoords(first);
    }
    if (Number.isFinite(first.lat) && Number.isFinite(first.lon)) {
      console.log('✅ 유효 후보 없음 → 1순위 강매칭');
      picked = [first];
    }
  }

  // 최종 결과 정리
  const result = (picked.length ? picked : []).map((p) => ({
    name: p.name || q,
    fullAddress: p.fullAddress || p.roadAddress || p.address || '',
    latitude: p.lat,
    longitude: p.lon,
  }));

  console.log('✅ 최종 POI 결과:', result.length, '개');
  result.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.name} (${r.fullAddress})`);
  });

  return result;
}
