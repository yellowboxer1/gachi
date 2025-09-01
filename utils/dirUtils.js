export function dir4FromAngle(deg) {
    const a = ((deg % 360) + 360) % 360; // 0~359
    if (a >= 315 || a < 45)   return '앞';
    if (a < 135)              return '오른쪽';
    if (a < 225)              return '뒤';
    return '왼쪽';
  }
  
  // 카메라 bbox 중심 x 기준 (0~1 정규화 가정)
  // 단안/전방 카메라 기반이면 보통 '뒤'는 나오지 않도록 처리
  export function dir4FromBBox(cx /*, cy */) {
    if (cx < 0.4)  return '왼쪽';
    if (cx > 0.6)  return '오른쪽';
    return '앞';
  }
  