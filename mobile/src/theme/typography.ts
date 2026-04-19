import { TextStyle } from 'react-native';

export const typography = {
  // Display — landing page hero, onboarding
  displayLarge: {
    fontSize: 48,
    lineHeight: 52,
    fontWeight: '800',
    letterSpacing: -1.5,
  } as TextStyle,
  displayMedium: {
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: -1,
  } as TextStyle,

  // Headings
  h1: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
  } as TextStyle,
  h2: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.25,
  } as TextStyle,
  h3: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
  } as TextStyle,

  // Body
  bodyLarge: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '400',
  } as TextStyle,
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  } as TextStyle,
  bodySmall: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  } as TextStyle,

  // Labels
  label: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  } as TextStyle,
  caption: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  } as TextStyle,

  // Buttons
  buttonLarge: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
  } as TextStyle,
  button: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  } as TextStyle,
} as const;

export type TypographyKey = keyof typeof typography;
