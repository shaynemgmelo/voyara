import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { colors, typography, spacing, radius } from '../theme';
import { tripsApi } from '../api/trips';
import { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'TripCreate'>;

export function TripCreateScreen() {
  const navigation = useNavigation<Nav>();
  const toast = useToast();
  const [destination, setDestination] = useState('');
  const [days, setDays] = useState('5');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    const numDays = parseInt(days, 10);
    if (!destination.trim()) {
      toast.error('Informe para onde você vai.');
      return;
    }
    if (isNaN(numDays) || numDays < 1 || numDays > 30) {
      toast.error('Dias inválidos — informe entre 1 e 30.');
      return;
    }

    setSaving(true);
    try {
      const finalName = title.trim() || `${destination} • ${numDays} dias`;
      const trip = await tripsApi.create({
        name: finalName,
        destination: destination.trim(),
        num_days: numDays,
      });
      navigation.replace('TripDetail', { tripId: trip.id });
    } catch (e: any) {
      toast.error(e.message ?? 'Falha ao criar roteiro');
    } finally {
      setSaving(false);
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
          <Text style={styles.title}>Para onde vamos?</Text>
          <Text style={styles.subtitle}>
            Diga o destino e os dias — a IA monta o roteiro dia a dia.
          </Text>

          <Input
            label="Destino"
            placeholder="Rio de Janeiro, Brasil"
            value={destination}
            onChangeText={setDestination}
            autoFocus
          />

          <Input
            label="Quantos dias?"
            placeholder="5"
            value={days}
            onChangeText={(v) => setDays(v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            maxLength={2}
          />

          <Input
            label="Título (opcional)"
            placeholder="Lua de mel no Rio"
            value={title}
            onChangeText={setTitle}
          />

          <View style={styles.hint}>
            <Text style={styles.hintText}>
              Dica: depois de criar, você pode colar links de viagem do TikTok
              ou Instagram pra enriquecer o roteiro com lugares reais.
            </Text>
          </View>

          <Button
            label="Criar roteiro"
            size="lg"
            fullWidth
            loading={saving}
            onPress={handleCreate}
            style={{ marginTop: spacing.xl }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingVertical: spacing.xl,
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
  hint: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    marginTop: spacing.lg,
  },
  hintText: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
