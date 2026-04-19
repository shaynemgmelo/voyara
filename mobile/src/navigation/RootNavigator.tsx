import React from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { colors } from '../theme';
import { RootStackParamList } from './types';

import { SplashScreen } from '../screens/SplashScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { MainTabs } from './MainTabs';
import { TripCreateScreen } from '../screens/TripCreateScreen';
import { TripDetailScreen } from '../screens/TripDetailScreen';
import { LinkAnalysisScreen } from '../screens/LinkAnalysisScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { ShareScreen } from '../screens/ShareScreen';
import { PaywallScreen } from '../screens/PaywallScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    primary: colors.primary,
    border: colors.border,
  },
};

export function RootNavigator() {
  const { session, loading } = useAuth();

  if (loading) {
    return null;
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTitleStyle: { color: colors.text },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        {session ? (
          <>
            <Stack.Screen
              name="Main"
              component={MainTabs}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="TripCreate"
              component={TripCreateScreen}
              options={{ title: 'Novo roteiro', presentation: 'modal' }}
            />
            <Stack.Screen
              name="TripDetail"
              component={TripDetailScreen}
              options={{ title: '' }}
            />
            <Stack.Screen
              name="LinkAnalysis"
              component={LinkAnalysisScreen}
              options={{ title: 'Analisar link' }}
            />
            <Stack.Screen
              name="Chat"
              component={ChatScreen}
              options={{ title: 'Assistente' }}
            />
            <Stack.Screen
              name="Share"
              component={ShareScreen}
              options={{ title: 'Compartilhar', presentation: 'modal' }}
            />
            <Stack.Screen
              name="Paywall"
              component={PaywallScreen}
              options={{ headerShown: false, presentation: 'modal' }}
            />
          </>
        ) : (
          <>
            <Stack.Screen
              name="Onboarding"
              component={OnboardingScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Auth"
              component={AuthScreen}
              options={{ headerShown: false }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
