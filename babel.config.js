module.exports = function (api) {
  api.cache(false);
  console.log('Babel config loaded');
  return {
      presets: ['babel-preset-expo'],
      plugins: [
          ['module:react-native-dotenv', {
              envName: 'APP_ENV',
              moduleName: '@env',
              path: '.env', // 이 파일만 로드
              safe: false,  // 선택적 파일 누락 허용
              allowUndefined: true, // 정의되지 않은 변수 허용
          }],
          ['@babel/plugin-transform-runtime', {
              helpers: true,
              regenerator: true,
          }],
      ],
  };
};