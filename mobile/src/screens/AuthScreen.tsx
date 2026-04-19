import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useAuth } from '../auth/AuthContext';
import { colors, typography, spacing, radius } from '../theme';

type Mode = 'login' | 'signup';

export function AuthScreen() {
  const { signInWithEmail, signUpWithEmail, signInWithApple, signInWithGoogle } =
    useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState<null | 'email' | 'apple' | 'google'>(null);

  const handleEmail = async () => {
    if (!email || !password) {
      Alert.alert('Preencha tudo', 'Informe email e senha.');
      return;
    }
    setLoading('email');
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password);
        Alert.alert(
          'Verifique seu email',
          'Enviamos um link de confirmação para seu email.',
        );
      }
    } catch (e: any) {
      Alert.alert('Erro', e.message ?? 'Falha no login');
    } finally {
      setLoading(null);
    }
  };

  const handleApple = async () => {
    setLoading('apple');
    try {
      await signInWithApple();
    } catch (e: any) {
      if (e.code !== 'ERR_CANCELED') {
        Alert.alert('Erro', e.message ?? 'Falha no Sign in with Apple');
      }
    } finally {
      setLoading(null);
    }
  };

  const handleGoogle = async () => {
    setLoading('google');
    try {
      await signInWithGoogle();
    } catch (e: any) {
      Alert.alert('Erro', e.message ?? 'Falha no login Google');
    } finally {
      setLoading(null);
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
          <Text style={styles.logo}>Mapass</Text>
          <Text style={styles.tagline}>
            {mode === 'login' ? 'Bom te ver de volta' : 'Crie sua conta'}
          </Text>

          {Platform.OS === 'ios' && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={radius.lg}
              style={styles.appleButton}
              onPress={handleApple}
            />
          )}

          <Button
            label="Continuar com Google"
            variant="secondary"
            size="lg"
            fullWidth
            loading={loading === 'google'}
            onPress={handleGoogle}
            style={{ marginBottom: spacing.xl }}
          />

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou com email</Text>
            <View style={styles.dividerLine} />
          </View>

          <Input
            placeholder="seu@email.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <Input
            placeholder="Senha"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
          />

          <Button
            label={mode === 'login' ? 'Entrar' : 'Criar conta'}
            size="lg"
            fullWidth
            loading={loading === 'email'}
            onPress={handleEmail}
          />

          <Button
            label={
              mode === 'login'
                ? 'Não tem conta? Cadastre-se'
                : 'Já tem conta? Entrar'
            }
            variant="ghost"
            size="md"
            fullWidth
            onPress={() => setMode(mode === 'login' ? 'signup' : 'login')}
            style={{ marginTop: spacing.md }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  logo: {
    ...typography.displayMedium,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  tagline: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.huge,
  },
  appleButton: {
    width: '100%',
    height: 54,
    marginBottom: spacing.md,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dividerText: {
    ...typography.bodySmall,
    color: colors.textTertiary,
    marginHorizontal: spacing.md,
  },
});
