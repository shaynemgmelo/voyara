import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { colors, typography, spacing, radius } from '../theme';
import { DayPlan, ItineraryItem, Trip, tripsApi } from '../api/trips';
import { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'TripDetail'>;
type Rt = RouteProp<RootStackParamList, 'TripDetail'>;

export function TripDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [dayPlans, setDayPlans] = useState<DayPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await tripsApi.get(params.tripId);
      setTrip(res.trip);
      setDayPlans(res.day_plans ?? []);
    } finally {
      setLoading(false);
    }
  }, [params.tripId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await tripsApi.generate(params.tripId);
      await load();
    } finally {
      setGenerating(false);
    }
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

  if (!trip) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.emptyText}>Roteiro não encontrado</Text>
        </View>
      </Screen>
    );
  }

  const hasItems = dayPlans.some((d) => (d.items?.length ?? 0) > 0);
  const allItems = dayPlans.flatMap((d) => d.items ?? []);
  const geocoded = allItems.filter(
    (i) => i.latitude != null && i.longitude != null,
  );

  const initialRegion = geocoded.length
    ? {
        latitude: geocoded[0].latitude!,
        longitude: geocoded[0].longitude!,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      }
    : undefined;

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {trip.title}
        </Text>
        <Text style={styles.meta}>
          {trip.destination} • {trip.num_days}{' '}
          {trip.num_days === 1 ? 'dia' : 'dias'}
        </Text>
        <View style={styles.actions}>
          <Button
            label="💬 Assistente"
            variant="secondary"
            size="sm"
            onPress={() => navigation.navigate('Chat', { tripId: trip.id })}
            style={{ marginRight: spacing.sm }}
          />
          <Button
            label="📤 Compartilhar"
            variant="secondary"
            size="sm"
            onPress={() => navigation.navigate('Share', { tripId: trip.id })}
          />
        </View>
      </View>

      {initialRegion ? (
        <View style={styles.mapWrap}>
          <MapView style={styles.map} initialRegion={initialRegion}>
            {geocoded.map((item) => (
              <Marker
                key={item.id}
                coordinate={{
                  latitude: item.latitude!,
                  longitude: item.longitude!,
                }}
                title={item.title}
                description={item.address ?? ''}
              />
            ))}
          </MapView>
        </View>
      ) : null}

      {!hasItems ? (
        <View style={styles.emptyCenter}>
          <Text style={styles.emptyTitle}>Pronto pra gerar?</Text>
          <Text style={styles.emptyText}>
            A IA vai montar um roteiro dia a dia com lugares reais.
          </Text>
          <Button
            label={generating ? 'Gerando...' : 'Gerar roteiro com IA'}
            size="lg"
            loading={generating}
            onPress={handleGenerate}
            style={{ marginTop: spacing.xxl }}
          />
          <Button
            label="Analisar um link"
            variant="ghost"
            onPress={() =>
              navigation.navigate('LinkAnalysis', { tripId: trip.id })
            }
            style={{ marginTop: spacing.md }}
          />
        </View>
      ) : (
        <FlatList
          data={dayPlans}
          keyExtractor={(d) => String(d.id)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item: day }) => (
            <View style={styles.daySection}>
              <Text style={styles.dayHeader}>
                Dia {day.day_number}
                {day.title ? ` • ${day.title}` : ''}
              </Text>
              {(day.items ?? []).map((it, idx) => (
                <Pressable
                  key={it.id}
                  onPress={() =>
                    it.google_place_id &&
                    Linking.openURL(
                      `https://www.google.com/maps/place/?q=place_id:${it.google_place_id}`,
                    )
                  }
                >
                  <Card style={styles.itemCard}>
                    <View style={styles.itemRow}>
                      <View style={styles.timeColumn}>
                        {it.start_time ? (
                          <Text style={styles.time}>
                            {it.start_time.slice(0, 5)}
                          </Text>
                        ) : (
                          <Text style={styles.timeDot}>•</Text>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemTitle} numberOfLines={1}>
                          {it.title}
                        </Text>
                        {it.address ? (
                          <Text style={styles.itemMeta} numberOfLines={1}>
                            {it.address}
                          </Text>
                        ) : null}
                        {it.rating ? (
                          <Text style={styles.itemRating}>
                            ★ {it.rating.toFixed(1)}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </Card>
                </Pressable>
              ))}
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  meta: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  actions: {
    flexDirection: 'row',
  },
  mapWrap: {
    height: 200,
  },
  map: {
    flex: 1,
  },
  emptyCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  emptyTitle: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyText: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  listContent: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  daySection: {
    marginBottom: spacing.xxl,
  },
  dayHeader: {
    ...typography.caption,
    color: colors.primary,
    marginBottom: spacing.md,
  },
  itemCard: {
    marginBottom: spacing.sm,
  },
  itemRow: {
    flexDirection: 'row',
  },
  timeColumn: {
    width: 56,
    alignItems: 'flex-start',
  },
  time: {
    ...typography.label,
    color: colors.text,
  },
  timeDot: {
    ...typography.label,
    color: colors.textTertiary,
  },
  itemTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: 2,
  },
  itemMeta: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  itemRating: {
    ...typography.bodySmall,
    color: colors.warning,
    marginTop: spacing.xs,
  },
});
