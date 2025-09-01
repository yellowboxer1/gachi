// app/_layout.js
import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import tts from './_components/ttsService';

export default function Layout() {
  useEffect(() => {
    // TTS 기본값 통일
    tts.setDefaults({ language: 'ko-KR', rate: 1.0, pitch: 1.0 });

    // (선택) expo-av 설치된 경우에만 오디오 모드 설정
    // 설치 안 되어도 에러 안 나게 동적 import
    (async () => {
      try {
        const { Audio } = await import('expo-av'); // 설치된 경우에만 로드
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          interruptionModeIOS: 1, // Audio.INTERRUPTION_MODE_IOS_DUCK_OTHERS
          shouldDuckAndroid: false,
          interruptionModeAndroid: 3, // Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX
          staysActiveInBackground: false,
          playThroughEarpieceAndroid: false,
        });
      } catch {
        // expo-av 미설치면 무시
        // console.log('[Audio] expo-av not available, skipping audio mode setup');
      }
    })();
  }, []);

  return (
    <>
      <StatusBar backgroundColor="#222222" barStyle="light-content" translucent={false} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="main" />
      </Stack>
    </>
  );
}
