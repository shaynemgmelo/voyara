import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  RouteProp,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useToast } from '../components/Toast';
import { colors, typography, spacing, radius } from '../theme';
import { tripsApi } from '../api/trips';
import { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'LinkAnalysis'>;
type Rt = RouteProp<RootStackParamList, 'LinkAnalysis'>;

interface Place {
  name: string;
  address?: string;
  rating?: number;
  photo_url?: string;
}

export function LinkAnalysisScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    destination: string;
    summary: string;
    places: Place[];
  } | null>(null);

  const handleAnalyze = async () => {
    if (!url.trim()) {
      toast.error('Cole um link do TikTok, Instagram ou YouTube.');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await tripsApi.analyzeUrl([url.trim()]);
      if (res.error) {
        toast.error(res.error);
      } else if (!res.places?.length) {
        toast.error(res.summary || 'Não consegui extrair lugares deste link.');
        setResult(res);
      } else {
        setResult(res);
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Falha ao analisar link');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTrip = async () => {
    if (!result) return;
    try {
      const trip = await tripsApi.create({
        name: `Roteiro em ${result.destination}`,
        destination: result.destination,
        num_days: Math.max(1, Math.ceil(result.places.length / 3)),
      });
      navigation.replace('TripDetail', { tripId: trip.id });
    } catch (e: any) {
      toast.error(e.message ?? 'Falha ao criar roteiro');
    }
  };

  return (
    <Screen padded>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Cole aquele vídeo</Text>
          <Text style={styles.subtitle}>
            TikTok, Instagram ou YouTube — a IA extrai os lugares e monta o
            roteiro com mapa.
          </Text>

          <Input
            placeholder="https://tiktok.com/..."
            value={url}
            onChangeText={setUrl}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Button
            label={loading ? 'Analisando...' : 'Analisar link'}
            size="lg"
            fullWidth
            loading={loading}
            onPress={handleAnalyze}
          />

          {loading && (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>
                Extraindo lugares do vídeo...
              </Text>
            </View>
          )}

          {result && (
            <View style={styles.result}>
              <Text style={styles.resultLabel}>Destino</Text>
              <Text style={styles.destination}>{result.destination || '—'}</Text>

              {result.summary ? (
                <Text style={styles.summary}>{result.summary}</Text>
              ) : null}

              <Text style={[styles.resultLabel, { marginTop: spacing.xl }]}>
                {result.places.length}{' '}
                {result.places.length === 1 ? 'lugar encontrado' : 'lugares encontrados'}
              </Text>

              {result.places.map((p, i) => (
                <Card key={`${p.name}-${i}`} style={styles.placeCard}>
                  <Text style={styles.placeName}>{p.name}</Text>
                  {p.address ? (
                    <Text style={styles.placeMeta}>{p.address}</Text>
                  ) : null}
                  {p.rating ? (
                    <Text style={styles.placeRating}>★ {p.rating.toFixed(1)}</Text>
                  ) : null}
                </Card>
              ))}

              {result.places.length > 0 && (
                <Button
                  label="Criar roteiro com esses lugares"
                  size="lg"
                  fullWidth
                  onPress={handleCreateTrip}
                  style={{ marginTop: spacing.xl }}
                />
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingVertical: spacing.xl,
    paddingBottom: spacing.huge,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    marginBottom: spacing.xxl,
  },
  loadingBox: {
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  result: {
    marginTop: spacing.xxl,
  },
  resultLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    marginBottom: spacing.xs,
  },
  destination: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  summary: {
    ...typography.body,
    color: colors.textSecondary,
  },
  placeCard: {
    marginTop: spacing.sm,
  },
  placeName: {
    ...typography.h3,
    color: colors.text,
    marginBottom: 2,
  },
  placeMeta: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  placeRating: {
    ...typography.bodySmall,
    color: colors.warning,
    marginTop: spacing.xs,
  },
});
