import * as dotenv from 'dotenv';
dotenv.config();

export default ({ config }) => ({
  ...config,
  name: 'gachi',
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
  },
  android: {
    package: 'com.gachigagae',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
  },
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
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
    [
      'expo-build-properties',
      {
        android: {
          extraMavenRepos: ['https://repository.map.naver.com/archive/maven'],
          enableJetifier: true,
        },
      },
    ],
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'Allow Gachi to use the microphone for voice recognition.',
        speechRecognitionPermission: 'Allow Gachi to use speech recognition.',
        androidSpeechServicePackages: ['com.google.android.googlequicksearchbox'],
      },
    ],
  ],
});
