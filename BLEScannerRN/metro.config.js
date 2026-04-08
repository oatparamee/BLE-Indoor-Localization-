// Metro bundler configuration for Expo SDK 54.
// Uses the default Expo metro config, which handles asset resolution,
// transformer settings, and platform-specific module resolution.
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = config;
