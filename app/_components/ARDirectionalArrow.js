// ARDirectionalArrow.js (Reanimated 전용 안전판)
import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';

// 정적 import (있으면 사용, 없으면 Fallback)
let BundledArrow = null;
try {
  BundledArrow = require('../../assets/images/3d_arrow.svg').default;
} catch (e) {
  BundledArrow = null;
}

const ARDirectionalArrow = ({
  visible = true,
  headingDeg = 0,        // 0 = 직진
  lateralOffset = 0,     // 좌우 px
  size = 160,
  assetFacingDeg = 0,    // SVG의 기준 방향(보통 0)
}) => {
  if (!visible) return null;

  // ====== Reanimated shared values ======
  const rot = useSharedValue(0);
  const offsetX = useSharedValue(0);
  const bob = useSharedValue(0);      // 위아래 점프(-8~0px)
  const pulse = useSharedValue(1);    // 스케일(0.95~1)

  // 회전/이동 최신화 (부드럽게 따라가도록 timing)
  useEffect(() => {
    const safeDeg = Number.isFinite(headingDeg) ? headingDeg : 0;
    const rotateDeg = (safeDeg - assetFacingDeg + 360) % 360;
    rot.value = withTiming(rotateDeg, { duration: 220, easing: Easing.out(Easing.cubic) });

    const sx = Number.isFinite(lateralOffset) ? lateralOffset : 0;
    offsetX.value = withTiming(sx, { duration: 180, easing: Easing.out(Easing.cubic) });
  }, [headingDeg, assetFacingDeg, lateralOffset, rot, offsetX]);

  // 지속 애니메이션(살짝 점프 + 펄스)
  useEffect(() => {
    bob.value = withRepeat(
      withSequence(
        withTiming(-8, { duration: 700, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 700, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false
    );
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.95, { duration: 600, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.0,  { duration: 600, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false
    );
    // 언마운트 시 자동 정리됨
  }, [bob, pulse]);

  // 스타일(모두 reanimated가 계산)
  const arrowStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: bob.value },
      { rotate: `${rot.value}deg` },
      { scale: pulse.value },
    ],
  }));

  return (
    // 부모가 core Animated.View를 쓰더라도, 안쪽은 일반 View + reanimated 전용 Animated.View로 “격리”
    <View pointerEvents="none" style={styles.container}>
      <Animated.View style={arrowStyle}>
        {BundledArrow ? (
          <BundledArrow width={size} height={size} />
        ) : (
          <Svg width={size} height={size} viewBox="0 0 100 100">
            <Path d="M45 90 L55 90 L55 35 L65 35 L50 10 L35 35 L45 35 Z" fill="#ffffff" />
            <Path d="M45 90 L55 90 L55 35 L65 35 L50 10 L35 35 L45 35 Z" fill="none" stroke="#000" strokeOpacity="0.25" />
          </Svg>
        )}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 200,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999,
    elevation: 999,
  },
});

export default ARDirectionalArrow;
