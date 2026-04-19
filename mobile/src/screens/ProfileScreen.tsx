import React from 'react';
import {
  Alert,
  Linking,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useAuth } from '../auth/AuthContext';
import { colors, typography, spacing, radius } from '../theme';
import { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const PRIVACY_URL = 'https://voyara-n5q8.onrender.com/privacy';
const TERMS_URL = 'https://voyara-n5q8.onrender.com/terms';
const SUPPORT_EMAIL = 'suporte@mapass.app';

export function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const { user, signOut, deleteAccount } = useAuth();

  const handleSignOut = () => {
    Alert.alert('Sair', 'Deseja sair da sua conta?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
          } catch (e: any) {
            Alert.alert('Erro', e.message ?? 'Falha ao sair');
          }
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Deletar conta',
      'Isso apaga permanentemente sua conta e todos os roteiros. Não pode ser desfeito.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Deletar conta',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount();
              Alert.alert('Conta deletada', 'Sua conta foi apagada.');
            } catch (e: any) {
              Alert.alert(
                'Erro',
                e.message ??
                  'Falha ao deletar conta. Escreva para ' + SUPPORT_EMAIL,
              );
            }
          },
        },
      ],
    );
  };

  return (
    <Screen padded>
      <View style={styles.headerCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>
            {(user?.email ?? 'U').charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.email} numberOfLines={1}>
          {user?.email ?? 'Sem email'}
        </Text>
      </View>

      <SectionTitle title="Assinatura" />
      <Card onPress={() => navigation.navigate('Paywall')} style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Mapass Pro</Text>
          <Text style={styles.rowMeta}>
            Roteiros ilimitados, IA ilimitada, sem anúncios
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Card>

      <SectionTitle title="Legal" />
      <Card
        onPress={() => Linking.openURL(PRIVACY_URL)}
        style={styles.row}
      >
        <Text style={[styles.rowTitle, { flex: 1 }]}>Política de privacidade</Text>
        <Text style={styles.chevron}>›</Text>
      </Card>
      <Card
        onPress={() => Linking.openURL(TERMS_URL)}
        style={[styles.row, { marginTop: spacing.sm }]}
      >
        <Text style={[styles.rowTitle, { flex: 1 }]}>Termos de uso</Text>
        <Text style={styles.chevron}>›</Text>
      </Card>

      <SectionTitle title="Suporte" />
      <Card
        onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
        style={styles.row}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Contato</Text>
          <Text style={styles.rowMeta}>{SUPPORT_EMAIL}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Card>

      <View style={styles.footer}>
        <Button
          label="Sair"
          variant="secondary"
          onPress={handleSignOut}
          fullWidth
        />
        <Button
          label="Deletar minha conta"
          variant="ghost"
          onPress={handleDeleteAccount}
          style={{ marginTop: spacing.md }}
        />
      </View>
    </Screen>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>;
}

const styles = StyleSheet.create({
  headerCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarLetter: {
    ...typography.displayMedium,
    color: colors.primary,
  },
  email: {
    ...typography.h3,
    color: colors.text,
  },
  sectionTitle: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: spacing.xxl,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowTitle: {
    ...typography.bodyLarge,
    color: colors.text,
  },
  rowMeta: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
  },
  chevron: {
    ...typography.h3,
    color: colors.textTertiary,
  },
  footer: {
    marginTop: spacing.xxxl,
    marginBottom: spacing.xl,
  },
});
