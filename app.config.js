import * as dotenv from 'dotenv';
dotenv.config();

export default ({ config }) => ({
  ...config,
  name: '가치가개',
  slug: 'gachi',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'myapp',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,

  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.gachigagae',
    infoPlist: {
      // VisionCamera / 음성 / 위치 권한 문자열
      NSCameraUsageDescription: '길안내 및 장애물 인식을 위해 카메라가 필요합니다.',
      NSMicrophoneUsageDescription: '음성 인식을 위해 마이크 접근이 필요합니다.',
      NSSpeechRecognitionUsageDescription: '음성 명령 처리를 위해 음성 인식을 사용합니다.',
      NSLocationWhenInUseUsageDescription: '길 안내를 위해 위치 정보가 필요합니다.',
    },
  },

  android: {
    package: 'com.gachigagae',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/images/icon.png',
      backgroundColor: '#ffffff',
    },
    // VisionCamera/음성/위치 권한
    permissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION', // 백그라운드 위치가 필요 없으면 제거
    ],
  },

  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/images/favicon.png',
  },

  plugins: [
    // 네이버 지도
    [
      '@mj-studio/react-native-naver-map',
      {
        client_id: process.env.NAVER_MAP_CLIENT_ID,
        android: {
          ACCESS_FINE_LOCATION: true,
          ACCESS_COARSE_LOCATION: true,
          ACCESS_BACKGROUND_LOCATION: true,
        },
        ios: {},
      },
    ],

    // 빌드 속성 (네이버 맵용 maven repo 등)
    [
      'expo-build-properties',
      {
        android: {
          extraMavenRepos: ['https://repository.map.naver.com/archive/maven'],
          enableJetifier: true,
        },
        ios: {
          // VisionCamera가 정적 프레임워크로 링크될 수 있게(충돌 예방용)
          useFrameworks: 'static',
        },
      },
    ],

    // VisionCamera (미리보기/촬영/프레임 프로세서용 권한 문자열)
    [
      'react-native-vision-camera',
      {
        cameraPermissionText: '길안내 및 장애물 인식을 위해 카메라가 필요합니다.',
        // microphonePermissionText를 별도로 쓰고 싶으면 여기에 추가 가능
      },
    ],

    // 음성 인식
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'Allow Gachi to use the microphone for voice recognition.',
        speechRecognitionPermission: 'Allow Gachi to use speech recognition.',
        androidSpeechServicePackages: ['com.google.android.googlequicksearchbox'],
      },
    ],
  ],

  // 런타임에서 쓸 환경변수(선택)
  extra: {
    NAVER_MAP_CLIENT_ID: process.env.NAVER_MAP_CLIENT_ID,
    NAVER_MAP_CLIENT_SECRET: process.env.NAVER_MAP_CLIENT_SECRET,
    NAVER_DEV_CLIENT_ID: process.env.NAVER_DEV_CLIENT_ID,        
    NAVER_DEV_CLIENT_SECRET: process.env.NAVER_DEV_CLIENT_SECRET,    
    TMAP_APP_KEY: process.env.TMAP_APP_KEY,
    ODSAY_API_KEY: process.env.ODSAY_API_KEY,
  },
});