// ARNavigationOverlay.js
import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Path, G } from 'react-native-svg';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/**
 * props:
 *  - visible: boolean
 *  - arrowCount?: number (default 7)
 *  - baseArrowSize?: number (default 64)
 *  - headingDeg?: number (default 0)     // 화면상 회전
 *  - lateralOffset?: number (default 0)  // 좌우 오프셋(px)
 */
export default function ARNavigationOverlay({
  visible = true,
  arrowCount = 7,
  baseArrowSize = 64,
  headingDeg = 0,
  lateralOffset = 0,
}) {
  if (!visible) return null;

  const arrows = useMemo(() => {
    const arr = [];
    for (let i = 0; i < arrowCount; i++) {
      const t = i / (arrowCount - 1);   // 0(가까움) ~ 1(멀리)
      const scale = 1 - t * 0.6;        // 멀수록 작게
      const opacity = 1 - t * 0.7;      // 멀수록 투명
      const y = SCREEN_H * (0.65 - t * 0.45);
      const size = baseArrowSize * scale;
      arr.push({ key: `arrow-${i}`, y, size, opacity });
    }
    return arr;
  }, [arrowCount, baseArrowSize]);

  const Arrow = ({ size = 64, opacity = 1 }) => {
    const w = size, h = size;
    const d = `
      M ${w * 0.5} 0
      L ${w} ${h * 0.6}
      L ${w * 0.78} ${h * 0.8}
      L ${w * 0.5} ${h * 0.45}
      L ${w * 0.22} ${h * 0.8}
      L 0 ${h * 0.6}
      Z
    `;
    return <Path d={d} fill="white" opacity={opacity} />;
  };

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={SCREEN_W} height={SCREEN_H}>
        <Defs>
          <LinearGradient id="laneGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopOpacity="0.6" stopColor="#E66A4D" />
            <Stop offset="1" stopOpacity="0" stopColor="#E66A4D" />
          </LinearGradient>
        </Defs>

        {/* 바닥 띠 (회전/오프셋 반영) */}
        <G
          transform={`
            translate(${SCREEN_W * 0.5 + lateralOffset}, ${SCREEN_H * 0.52})
            rotate(${headingDeg})
            translate(${-SCREEN_W * 0.5}, ${-SCREEN_H * 0.52})
          `}
        >
          <Rect
            x={SCREEN_W * 0.36}
            y={SCREEN_H * 0.15}
            width={SCREEN_W * 0.28}
            height={SCREEN_H * 0.75}
            fill="url(#laneGrad)"
            rx={SCREEN_W * 0.14}
          />
        </G>

        {/* 화살표 (회전/오프셋 반영) */}
        {arrows.map((a) => (
          <G
            key={a.key}
            transform={`
              translate(${SCREEN_W * 0.5 + lateralOffset}, ${a.y})
              rotate(${headingDeg})
              translate(${-a.size * 0.5}, ${-a.size * 0.5})
            `}
          >
            <Arrow size={a.size} opacity={a.opacity} />
          </G>
        ))}
      </Svg>
    </View>
  );
}
