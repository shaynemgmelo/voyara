import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, StyleSheet } from 'react-native';
import { colors, typography } from '../theme';
import { TabParamList } from './types';

import { HomeScreen } from '../screens/HomeScreen';
import { AnalyzeScreen } from '../screens/AnalyzeScreen';
import { ProfileScreen } from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator<TabParamList>();

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={styles.iconWrap}>
      <Text style={[styles.iconText, { color: focused ? colors.primary : colors.textTertiary }]}>
        {label}
      </Text>
    </View>
  );
}

export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: {
          backgroundColor: colors.bgElevated,
          borderTopColor: colors.border,
          height: 88,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: { ...typography.caption, marginTop: 2 },
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { color: colors.text, ...typography.h2 },
        headerShadowVisible: false,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'Meus roteiros',
          tabBarLabel: 'Viagens',
          tabBarIcon: ({ focused }) => <TabIcon label="✈" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Analyze"
        component={AnalyzeScreen}
        options={{
          title: 'Descobrir',
          tabBarLabel: 'Descobrir',
          tabBarIcon: ({ focused }) => <TabIcon label="✨" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: 'Perfil',
          tabBarLabel: 'Perfil',
          tabBarIcon: ({ focused }) => <TabIcon label="●" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 22,
  },
});
