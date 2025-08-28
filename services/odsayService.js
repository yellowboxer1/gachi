import { ENV } from './env';
import { monitor } from './monitoring';

const ODSAY_BASE = 'https://api.odsay.com/v1/api';

// OPT: 0=최단시간, 1=최소환승, 2=최소도보, ... (문서 기준)
export async function getTransitRoutesOD({ sx, sy, ex, ey, opt = 0, lang = 0 }) {
  if (!ENV.ODSAY_API_KEY) throw new Error('Missing ODSAY_API_KEY');

  const url =
    `${ODSATY_BASE_FIX()}/searchPubTransPathT` + // ← 아래 헬퍼로 오탈자 대비
    `?sx=${encodeURIComponent(sx)}` +
    `&sy=${encodeURIComponent(sy)}` +
    `&ex=${encodeURIComponent(ex)}` +
    `&ey=${encodeURIComponent(ey)}` +
    `&opt=${encodeURIComponent(opt)}` +
    `&lang=${encodeURIComponent(lang)}` +
    `&apiKey=${encodeURIComponent(ENV.ODSAY_API_KEY)}` +
    `&output=json`;

  const res = await fetch(url, { method: 'GET' });
  const json = await res.json();

  // 에러 처리 (ODsay는 200 안에서도 error 객체를 줄 수 있음)
  if (!json?.result?.path) {
    const err = json?.error || json;
    throw new Error(`ODsay route error: ${JSON.stringify(err)}`);
  }

  // 모니터링: 대중교통 호출 카운트 (ODsay)
  monitor.incTransit('odsay');

  return json.result.path; // 후보 경로 배열
}

// 일부 가이드에 오타나 버전 차이가 있는 경우가 있어 방어적으로 구성
function ODSATY_BASE_FIX() {
  // 오타 방지 및 향후 베이스 경로 변경 여지 대비
  return ODSAY_BASE;
}

// 내부 공통 모델로 매핑
export function mapOdsayPathToModel(odsayPath) {
  const info = odsayPath.info; // totalTime, payment, totalDistance 등
  const legs = (odsayPath.subPath || []).map((s) => ({
    type: s.trafficType,               // 1 지하철 / 2 버스 / 3 도보
    sectionTime: s.sectionTime,
    distance: s.distance,
    lane: s.lane,                      // 노선 정보
    stations: s.passStopList?.stations || [],
    startName: s.startName,
    endName: s.endName,
    startX: s.startX, startY: s.startY,
    endX: s.endX, endY: s.endY,
  }));
  return { summary: info, legs };
}
