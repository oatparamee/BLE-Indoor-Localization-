// Babel configuration required by Expo.
// The 'babel-preset-expo' preset includes all necessary transforms
// for React Native and Expo features.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
