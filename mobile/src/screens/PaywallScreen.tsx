import React, { useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { colors, typography, spacing, radius } from '../theme';
import { purchasePackage, PLAN_IDS } from '../api/purchases';
import { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Paywall'>;

type PlanId = keyof typeof PLAN_IDS;

const plans: { id: PlanId; title: string; price: string; hint?: string }[] = [
  { id: 'monthly', title: 'Mensal', price: 'R$ 19,90/mês' },
  {
    id: 'annual',
    title: 'Anual',
    price: 'R$ 149/ano',
    hint: 'Economize 37%',
  },
];

const features = [
  '✨ Roteiros ilimitados',
  '🧠 Assistente IA ilimitado',
  '🔗 Análise de links ilimitada',
  '🗺️ Mapa offline',
  '🚫 Sem anúncios',
  '📤 Compartilhamento avançado',
];

export function PaywallScreen() {
  const navigation = useNavigation<Nav>();
  const [selected, setSelected] = useState<PlanId>('annual');
  const [purchasing, setPurchasing] = useState(false);

  const handlePurchase = async () => {
    setPurchasing(true);
    try {
      await purchasePackage(selected);
      Alert.alert('Obrigado!', 'Assinatura ativada.');
      navigation.goBack();
    } catch (e: any) {
      if (e.userCancelled) return;
      Alert.alert('Erro', e.message ?? 'Falha na compra');
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <Screen padded>
      <Pressable style={styles.close} onPress={() => navigation.goBack()}>
        <Text style={styles.closeText}>✕</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Text style={styles.emoji}>⚡</Text>
          <Text style={styles.title}>Mapass Pro</Text>
          <Text style={styles.subtitle}>
            Planeje viagens incríveis sem limites.
          </Text>
        </View>

        <View style={styles.features}>
          {features.map((f) => (
            <Text key={f} style={styles.feature}>
              {f}
            </Text>
          ))}
        </View>

        <View style={styles.plans}>
          {plans.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setSelected(p.id)}
              style={[
                styles.plan,
                selected === p.id && styles.planSelected,
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.planTitle}>{p.title}</Text>
                <Text style={styles.planPrice}>{p.price}</Text>
              </View>
              {p.hint ? (
                <View style={styles.hintBadge}>
                  <Text style={styles.hintText}>{p.hint}</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>

        <Button
          label="Continuar"
          size="lg"
          fullWidth
          loading={purchasing}
          onPress={handlePurchase}
          style={{ marginTop: spacing.xl }}
        />

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            A assinatura renova automaticamente. Cancele a qualquer momento nas
            configurações da App Store.
          </Text>
          <View style={styles.footerLinks}>
            <Pressable
              onPress={() =>
                Linking.openURL('https://voyara-n5q8.onrender.com/terms')
              }
            >
              <Text style={styles.link}>Termos</Text>
            </Pressable>
            <Text style={styles.footerText}> • </Text>
            <Pressable
              onPress={() =>
                Linking.openURL('https://voyara-n5q8.onrender.com/privacy')
              }
            >
              <Text style={styles.link}>Privacidade</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  close: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    zIndex: 10,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    ...typography.h2,
    color: colors.textSecondary,
  },
  scroll: {
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
  },
  emoji: {
    fontSize: 56,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.displayMedium,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  features: {
    marginBottom: spacing.xxl,
  },
  feature: {
    ...typography.bodyLarge,
    color: colors.text,
    marginBottom: spacing.md,
  },
  plans: {
    gap: spacing.md,
  },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  planSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  planTitle: {
    ...typography.h3,
    color: colors.text,
  },
  planPrice: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  hintBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  hintText: {
    ...typography.label,
    color: colors.text,
  },
  footer: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  footerText: {
    ...typography.bodySmall,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  footerLinks: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  link: {
    ...typography.bodySmall,
    color: colors.primary,
  },
});
