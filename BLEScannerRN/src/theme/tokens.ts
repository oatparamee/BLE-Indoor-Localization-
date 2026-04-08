import { Platform } from 'react-native';

export const colors = {
  background: '#F4EFE5',
  backgroundAccent: '#E7F2EF',
  surface: '#FFFFFF',
  surfaceMuted: '#F8FBFA',
  border: '#D5E1DE',
  textPrimary: '#16243A',
  textSecondary: '#516175',
  textMuted: '#7A8795',
  accent: '#0F766E',
  accentStrong: '#115E59',
  accentSoft: '#DDF3EE',
  accentMuted: '#EEF8F5',
  info: '#0EA5E9',
  success: '#059669',
  warning: '#D97706',
  danger: '#DC2626',
  sand: '#E8DDCD',
  shadow: '#0F172A',
};

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 36,
};

export const radii = {
  sm: 10,
  md: 16,
  lg: 24,
  pill: 999,
};

export const typography = {
  eyebrow: 11,
  caption: 12,
  body: 14,
  section: 16,
  title: 22,
  hero: 30,
};

export const layout = {
  screenPadding: 20,
};

export const shadows = Platform.select({
  ios: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  android: {
    elevation: 4,
  },
  default: {},
});
