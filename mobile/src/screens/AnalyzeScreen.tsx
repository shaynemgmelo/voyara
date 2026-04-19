import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { colors, typography, spacing } from '../theme';
import { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function AnalyzeScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <Screen padded>
      <View style={styles.container}>
        <View style={styles.circle}>
          <Text style={styles.emoji}>✨</Text>
        </View>
        <Text style={styles.title}>Descubra lugares{"\n"}a partir de vídeos</Text>
        <Text style={styles.description}>
          Cole um link de TikTok, Instagram ou YouTube e a IA monta um roteiro
          real com mapa, horários e avaliações.
        </Text>

        <Button
          label="Colar um link"
          size="lg"
          fullWidth
          onPress={() => navigation.navigate('LinkAnalysis', {})}
          style={{ marginTop: spacing.xxl }}
        />
        <Button
          label="Criar do zero"
          variant="secondary"
          size="lg"
          fullWidth
          onPress={() => navigation.navigate('TripCreate')}
          style={{ marginTop: spacing.md }}
        />

        <Card style={styles.tipCard}>
          <Text style={styles.tipLabel}>DICA</Text>
          <Text style={styles.tipText}>
            Funciona melhor com vídeos de viagem que listam lugares específicos
            — restaurantes, pontos turísticos, bares, praias.
          </Text>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  circle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xxl,
  },
  emoji: {
    fontSize: 56,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  description: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  tipCard: {
    marginTop: spacing.xxl,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  tipLabel: {
    ...typography.caption,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  tipText: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
