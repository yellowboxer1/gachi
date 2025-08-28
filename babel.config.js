module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Expo Router 사용 중이면 포함
      'expo-router/babel',

      // .env → JS 런타임 주입
      [
        'module:react-native-dotenv',
        {
          moduleName: '@env',
          path: '.env',
          safe: false,
          allowUndefined: true,
          verbose: false,
        },
      ],

      'react-native-reanimated/plugin',
    ],
  };
};
