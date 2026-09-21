import React from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize } from '../../constants/theme';
import { V2Colors } from '../../constants/v2Theme';
import { isHealthV2TodayEnabled } from '../../utils/healthV2Today';
import { isHealthspanUIEnabled } from '../../utils/healthspan';

type Icon = React.ComponentProps<typeof Ionicons>['name'];
export default function TabLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const v2 = isHealthspanUIEnabled();
  const todayOnly = isHealthV2TodayEnabled();
  const hidden = { href: null } as const;
  const icon = (name: Icon) => ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;
  const back = (fallback: '/train' | '/fuel' | '/healthspan') => () => (
    <Pressable accessibilityRole="button" accessibilityLabel="Back to overview" style={{ width: 48, height: 48, justifyContent: 'center', alignItems: 'center' }} onPress={() => router.canGoBack() ? router.back() : router.replace(fallback)}>
      <Ionicons name="arrow-back" size={23} color={Colors.text} />
    </Pressable>
  );
  const detail = (title: string, fallback: '/train' | '/fuel' | '/healthspan') => ({ ...hidden, title, headerShown: true, headerLeft: back(fallback) });
  const settings = () => <Pressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => router.push('/settings')} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="settings-outline" size={22} color={Colors.text} /></Pressable>;
  return (
    <Tabs backBehavior="history" screenOptions={{
      headerShown: !v2,
      headerStyle: { backgroundColor: Colors.surface }, headerTintColor: Colors.text,
      headerTitleStyle: { fontWeight: '700', fontSize: FontSize.md }, headerShadowVisible: false,
      tabBarStyle: { backgroundColor: v2 || todayOnly ? V2Colors.surface : Colors.tabBar, borderTopColor: Colors.border, borderTopWidth: 0.5, height: 58 + Math.max(insets.bottom, 8), paddingBottom: Math.max(insets.bottom, 8), paddingTop: 8 },
      tabBarActiveTintColor: v2 || todayOnly ? V2Colors.primary : Colors.primary,
      tabBarInactiveTintColor: v2 || todayOnly ? V2Colors.textMuted : Colors.textMuted,
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' }, tabBarHideOnKeyboard: true,
    }}>
      <Tabs.Screen name="index" options={{ title: v2 ? 'Today' : 'Log', headerTitle: 'GainLog', tabBarIcon: icon(v2 ? 'home-outline' : 'add-circle-outline') }} />
      <Tabs.Screen name="healthspan" options={v2 ? { title: 'Health', tabBarIcon: icon('heart-outline') } : hidden} />
      <Tabs.Screen name="train" options={v2 ? { title: 'Train', tabBarIcon: icon('barbell-outline') } : hidden} />
      <Tabs.Screen name="fuel" options={v2 ? { title: 'Fuel', tabBarIcon: icon('restaurant-outline') } : hidden} />
      <Tabs.Screen name="progress" options={v2 ? { title: 'Trends', tabBarIcon: icon('analytics-outline') } : hidden} />
      <Tabs.Screen name="history" options={v2 ? detail('Workout history', '/train') : { title: 'History', tabBarIcon: icon('time-outline') }} />
      <Tabs.Screen name="stats" options={v2 ? detail('Strength progress', '/train') : { title: 'Stats', tabBarIcon: icon('bar-chart-outline') }} />
      <Tabs.Screen name="health" options={v2 ? detail('Tracking & goals', '/healthspan') : { title: todayOnly ? 'Today' : 'Health', headerShown: !todayOnly, headerRight: settings, tabBarIcon: icon(todayOnly ? 'home-outline' : 'scale-outline') }} />
      <Tabs.Screen name="nutrition" options={v2 ? detail('Food diary', '/fuel') : { title: 'Nutrition', tabBarIcon: icon('restaurant-outline') }} />
      <Tabs.Screen name="workout" options={detail('Log workout', '/train')} />
    </Tabs>
  );
}
