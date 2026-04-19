import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  RouteProp,
  useRoute,
} from '@react-navigation/native';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { colors, typography, spacing, radius } from '../theme';
import { api } from '../api/client';
import { RootStackParamList } from '../navigation/types';

type Rt = RouteProp<RootStackParamList, 'Share'>;

const BASE_SHARE_URL = 'https://voyara-n5q8.onrender.com/share';

export function ShareScreen() {
  const { params } = useRoute<Rt>();
  const [loading, setLoading] = useState(true);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const loadShare = useCallback(async () => {
    try {
      const res = await api.post<{ share_token: string }>(
        `/trips/${params.tripId}/share`,
      );
      setShareUrl(`${BASE_SHARE_URL}/${res.share_token}`);
    } catch (e) {
      setShareUrl(`${BASE_SHARE_URL}/trip-${params.tripId}`);
    } finally {
      setLoading(false);
    }
  }, [params.tripId]);

  useEffect(() => {
    loadShare();
  }, [loadShare]);

  const copy = () => {
    if (!shareUrl) return;
    Clipboard.setString(shareUrl);
    Alert.alert('Copiado', 'O link foi copiado para a área de transferência.');
  };

  const shareNative = async () => {
    if (!shareUrl) return;
    try {
      await Share.share({
        message: `Confere meu roteiro no Mapass: ${shareUrl}`,
        url: shareUrl,
      });
    } catch {}
  };

  return (
    <Screen padded>
      <View style={styles.header}>
        <View style={styles.circle}>
          <Text style={styles.emoji}>📤</Text>
        </View>
        <Text style={styles.title}>Compartilhar roteiro</Text>
        <Text style={styles.subtitle}>
          Quem tem o link consegue ver o roteiro sem precisar de conta.
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <>
          <Card style={styles.urlCard}>
            <Text style={styles.urlLabel}>Link público</Text>
            <Text style={styles.url} numberOfLines={1}>
              {shareUrl}
            </Text>
          </Card>

          <Button
            label="Compartilhar"
            size="lg"
            fullWidth
            onPress={shareNative}
            style={{ marginTop: spacing.xl }}
          />
          <Button
            label="Copiar link"
            variant="secondary"
            size="lg"
            fullWidth
            onPress={copy}
            style={{ marginTop: spacing.md }}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  circle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emoji: {
    fontSize: 44,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  urlCard: {
    marginTop: spacing.xl,
  },
  urlLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    marginBottom: spacing.xs,
  },
  url: {
    ...typography.body,
    color: colors.primary,
  },
});
