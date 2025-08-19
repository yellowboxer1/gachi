const NAVER_CLIENT_ID = process.env.EXPO_PUBLIC_NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.EXPO_PUBLIC_NAVER_CLIENT_SECRET;

const NCP_KEY_ID = process.env.EXPO_PUBLIC_NCP_MAP_KEY_ID;
const NCP_KEY = process.env.EXPO_PUBLIC_NCP_MAP_KEY;

// 개발용 목업 (키 없거나 네트워크 이슈 시)
const DEV_MOCK = [
  { q: ['부산역','busan station'], name: '부산역', lat: 35.115137, lng: 129.040128, addr: '부산 동구' },
  { q: ['해운대','해운대해수욕장'], name: '해운대해수욕장', lat: 35.158698, lng: 129.160384, addr: '부산 해운대구' },
  { q: ['광안리','광안리해수욕장'], name: '광안리해수욕장', lat: 35.153220, lng: 129.118652, addr: '부산 수영구' },
  { q: ['센텀','센텀시티'], name: '센텀시티', lat: 35.169967, lng: 129.129402, addr: '부산 해운대구' },
];

function stripHtml(s = '') {
  return s.replace(/<[^>]+>/g, '');
}

function normalizeQuery(q) {
  return (q || '').replace(/\s{2,}/g, ' ').trim();
}

async function naverLocalSearch(query, display = 20, start = 1) {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    // 키 없으면 빈 배열 반환 (목업에서 처리)
    return [];
  }
  const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=${display}&start=${start}`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
    },
  });
  if (!res.ok) {
    // 400/401/429 등
    return [];
  }
  const json = await res.json().catch(() => ({}));
  return Array.isArray(json.items) ? json.items : [];
}

// TM128 → WGS84 일괄 변환
async function transformTm128ToWgs84(points /* [{x:tmX, y:tmY}] */) {
  if (!points?.length) return [];
  if (!NCP_KEY_ID || !NCP_KEY) {
    // 좌표 변환 키가 없으면 변환 불가
    return [];
  }
  const qs = new URLSearchParams({
    source: 'tm128',
    target: 'wgs84',
  });
  const body = JSON.stringify({ points: points.map(p => ({ x: p.x, y: p.y })) });

  const res = await fetch(`https://naveropenapi.apigw..com/map-transform/v1/transform?${qs}`, {
    method: 'POST',
    headers: {
      'X-NCP-APIGW-API-KEY-ID': NCP_KEY_ID,
      'X-NCP-APIGW-API-KEY': NCP_KEY,
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!res.ok) return [];
  const json = await res.json().catch(() => ({}));
  const arr = json?.points;
  return Array.isArray(arr) ? arr.map(p => ({ latitude: p.y, longitude: p.x })) : [];
}

// 개발용 목업 검색
function devMockSearch(query) {
  const q = normalizeQuery(query);
  const hits = DEV_MOCK.filter(m => m.q.some(k => q.includes(k)));
  return hits.map(h => ({
    name: h.name,
    upperAddrName: '부산',
    middleAddrName: '',
    lowerAddrName: '',
    fullAddress: h.addr,
    latitude: h.lat,
    longitude: h.lng,
    firstNo: '0',
    secondNo: '0',
  }));
}

/**
 * 네이버 기반 POI 검색
 * @param {string} query
 * @param {{latitude:number, longitude:number}=} center (정렬용으로만 사용)
 * @returns {Promise<Array<{name, upperAddrName, middleAddrName, lowerAddrName, fullAddress, latitude, longitude, firstNo, secondNo}>>}
 */
export async function getPoiCoordinates(query, center) {
  const q = normalizeQuery(query);

  // 1) 네이버 로컬 검색
  let items = await naverLocalSearch(q, 20, 1);

  // 0건이면 보정 시도(공백 제거 → 키워드 분해)
  if (!items.length) {
    const q2 = q.replace(/\s+/g, '');
    items = await naverLocalSearch(q2, 20, 1);
    if (!items.length) {
      const tokens = q.split(' ').filter(t => t.length > 1);
      for (const t of tokens) {
        // eslint-disable-next-line no-await-in-loop
        items = await naverLocalSearch(t, 20, 1);
        if (items.length) break;
      }
    }
  }

  // 키/네트워크 문제거나 여전히 0건이면 목업 리턴
  if (!items.length) {
    return devMockSearch(q);
  }

  // 2) TM128 → WGS84 변환
  // Naver local의 mapx/mapy는 TM128 좌표계(문자열)로 들어옴
  const tmPoints = items
    .map(it => ({ x: Number(it.mapx), y: Number(it.mapy) }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

  let wgsPoints = await transformTm128ToWgs84(tmPoints);

  // 변환 실패 시(키 없음 등) 포기 → 결과 제공 못함 → 목업 보조
  if (wgsPoints.length !== tmPoints.length) {
    const mock = devMockSearch(q);
    if (mock.length) return mock;
    return [];
  }

  // 3) 결과 조립
  const pois = items.map((it, idx) => {
    const title = stripHtml(it.title || '').trim(); // <b>태그 제거
    const fullAddr = (it.roadAddress || it.address || '').trim();
    const [upper, middle, lower] = fullAddr.split(' ').slice(0, 3);
    const coords = wgsPoints[idx];

    return {
      name: title,
      upperAddrName: upper || '',
      middleAddrName: middle || '',
      lowerAddrName: lower || '',
      fullAddress: fullAddr,
      latitude: coords?.latitude,
      longitude: coords?.longitude,
      firstNo: '',
      secondNo: '',
    };
  }).filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

  // 4) center가 있으면 거리 기준으로 가벼운 정렬(후단에서 정확도 스코어링을 따로 함)
  if (center?.latitude && center?.longitude) {
    pois.sort((a, b) => {
      const dx1 = a.longitude - center.longitude;
      const dy1 = a.latitude - center.latitude;
      const dx2 = b.longitude - center.longitude;
      const dy2 = b.latitude - center.latitude;
      return (dx1*dx1 + dy1*dy1) - (dx2*dx2 + dy2*dy2);
    });
  }

  return pois;
}
