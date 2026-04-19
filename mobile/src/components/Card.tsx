import React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../theme';

interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}

export function Card({ children, onPress, style, padded = true }: CardProps) {
  const Container = onPress ? Pressable : View;
  return (
    <Container
      onPress={onPress}
      style={({ pressed }: any) => [
        styles.card,
        padded && styles.padded,
        pressed && onPress && styles.pressed,
        style,
      ]}
    >
      {children}
    </Container>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  padded: {
    padding: spacing.lg,
  },
  pressed: {
    opacity: 0.85,
  },
});
