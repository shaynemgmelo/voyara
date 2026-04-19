import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { colors, typography } from '../theme';

export function SplashScreen() {
  return (
    <Screen>
      <View style={styles.container}>
        <Text style={styles.logo}>Mapass</Text>
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    ...typography.displayMedium,
    color: colors.text,
    marginBottom: 24,
  },
  loader: {
    marginTop: 16,
  },
});
