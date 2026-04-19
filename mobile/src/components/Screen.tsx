import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { colors } from '../theme';

interface ScreenProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  edges?: Edge[];
  padded?: boolean;
}

export function Screen({ children, style, edges = ['top', 'bottom'], padded }: ScreenProps) {
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <StatusBar style="light" />
      <View style={[styles.container, padded && styles.padded, style]}>
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: 20,
  },
});
