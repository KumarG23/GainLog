import { V2Colors } from './v2Theme';

const LegacyColors = {
  background: '#0D0D0D',
  surface: '#1C1C1E',
  surfaceRaised: '#222225',
  card: '#2C2C2E',
  cardBorder: '#3A3A3C',

  primary: '#FF6B35',
  primaryDim: 'rgba(255, 107, 53, 0.15)',
  primaryDark: '#C44E1E',

  success: '#32D74B',
  successDim: 'rgba(50, 215, 75, 0.12)',
  danger: '#FF453A',
  dangerDim: 'rgba(255, 69, 58, 0.12)',
  warning: '#FFD60A',
  warningDim: 'rgba(255, 214, 10, 0.12)',

  text: '#FFFFFF',
  textSecondary: '#AEAEB2',
  textMuted: '#8E8E93',

  border: '#3A3A3C',
  borderSubtle: '#303033',
  inputBg: '#1C1C1E',
  tabBar: '#111111',
  separator: '#2C2C2E',
};

// Reuse the same semantic tokens in legacy editors and new overview screens.
export const Colors = process.env.EXPO_PUBLIC_GAINLOG_V2_UI === '1' ? {
  ...LegacyColors,
  background: V2Colors.background, surface: V2Colors.surface,
  surfaceRaised: V2Colors.elevated, card: V2Colors.elevated,
  cardBorder: V2Colors.divider, primary: '#258476',
  primaryDim: V2Colors.primaryDim, primaryDark: '#238E80',
  text: V2Colors.text, textSecondary: V2Colors.textSecondary, textMuted: V2Colors.textMuted,
  border: V2Colors.divider, borderSubtle: V2Colors.divider,
  inputBg: V2Colors.surface, tabBar: V2Colors.surface, separator: V2Colors.divider,
  success: V2Colors.positive, warning: V2Colors.caution, danger: V2Colors.alert,
} : LegacyColors;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
};

export const FontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 20,
  xl: 24,
  xxl: 28,
  xxxl: 34,
};
