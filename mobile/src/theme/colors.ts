export const colors = {
  // Background
  bg: '#0B0B0F',
  bgElevated: '#151518',
  bgCard: '#1C1C21',
  bgInput: '#222229',

  // Brand
  primary: '#FF5722',
  primaryHover: '#E64A1A',
  primaryMuted: 'rgba(255, 87, 34, 0.15)',

  // Text
  text: '#FFFFFF',
  textSecondary: '#A8A8B0',
  textTertiary: '#6B6B74',
  textInverse: '#0B0B0F',

  // Borders / dividers
  border: '#2A2A31',
  borderLight: '#3A3A42',

  // Status
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',

  // Map / misc
  mapOverlay: 'rgba(11, 11, 15, 0.8)',
  transparent: 'transparent',
} as const;

export type ColorKey = keyof typeof colors;
