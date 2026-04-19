import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { colors, typography, spacing, radius } from '../theme';
import { Trip, tripsApi } from '../api/trips';
import { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await tripsApi.list();
      setTrips(res.trips ?? []);
    } catch (e) {
      // silently fail, show empty state
      setTrips([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (trips.length === 0) {
    return (
      <Screen padded>
        <View style={styles.empty}>
          <View style={styles.emptyCircle}>
            <Text style={styles.emptyEmoji}>✈️</Text>
          </View>
          <Text style={styles.emptyTitle}>Seu primeiro roteiro</Text>
          <Text style={styles.emptyText}>
            Crie um roteiro do zero ou cole um link de viagem do TikTok,
            Instagram ou YouTube.
          </Text>
          <Button
            label="Criar roteiro"
            size="lg"
            onPress={() => navigation.navigate('TripCreate')}
            style={{ marginTop: spacing.xxl, minWidth: 200 }}
          />
          <Button
            label="Analisar um link"
            variant="ghost"
            onPress={() => navigation.navigate('LinkAnalysis', {})}
            style={{ marginTop: spacing.md }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded>
      <FlatList
        data={trips}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerRow}>
            <Button
              label="+ Novo roteiro"
              size="md"
              onPress={() => navigation.navigate('TripCreate')}
              style={{ flex: 1, marginRight: spacing.sm }}
            />
            <Button
              label="✨ Link"
              variant="secondary"
              size="md"
              onPress={() => navigation.navigate('LinkAnalysis', {})}
              style={{ flex: 1, marginLeft: spacing.sm }}
            />
          </View>
        }
        renderItem={({ item }) => (
          <Card
            onPress={() => navigation.navigate('TripDetail', { tripId: item.id })}
            style={styles.card}
          >
            <Text style={styles.tripTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.tripMeta} numberOfLines={1}>
              {item.destination} • {item.num_days}{' '}
              {item.num_days === 1 ? 'dia' : 'dias'}
            </Text>
            {item.start_date ? (
              <Text style={styles.tripDate}>
                {formatDateRange(item.start_date, item.end_date)}
              </Text>
            ) : null}
          </Card>
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      />
    </Screen>
  );
}

function formatDateRange(start: string, end: string | null | undefined) {
  const s = new Date(start);
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };
  if (!end) return s.toLocaleDateString('pt-BR', opts);
  const e = new Date(end);
  return `${s.toLocaleDateString('pt-BR', opts)} — ${e.toLocaleDateString(
    'pt-BR',
    opts,
  )}`;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: {
    paddingVertical: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    marginBottom: spacing.xl,
  },
  card: {
    padding: spacing.xl,
  },
  tripTitle: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  tripMeta: {
    ...typography.body,
    color: colors.textSecondary,
  },
  tripDate: {
    ...typography.bodySmall,
    color: colors.textTertiary,
    marginTop: spacing.sm,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xxl,
  },
  emptyEmoji: {
    fontSize: 56,
  },
  emptyTitle: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  emptyText: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
