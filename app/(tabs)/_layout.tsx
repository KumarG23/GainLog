import React, { useEffect, useRef } from 'react';
import { Tabs, usePathname, useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/theme';
import { isHealthspanEnabled } from '../../utils/healthspan';
import { isHealthV2TodayEnabled } from '../../utils/healthV2Today';
import { V2Colors } from '../../constants/v2Theme';

type Icon = React.ComponentProps<typeof Ionicons>['name'];
type Tab = { name: string; title: string; icon: Icon; active: Icon };
const v2Tabs: Tab[] = [
  { name: 'today', title: 'Today', icon: 'home-outline', active: 'home' },
  { name: 'healthspan', title: 'Health', icon: 'heart-outline', active: 'heart' },
  { name: 'train', title: 'Train', icon: 'barbell-outline', active: 'barbell' },
  { name: 'fuel', title: 'Fuel', icon: 'restaurant-outline', active: 'restaurant' },
  { name: 'insights', title: 'Trends', icon: 'analytics-outline', active: 'analytics' },
];
const legacyTabs: Tab[] = [
  { name: 'index', title: 'Log', icon: 'add-circle-outline', active: 'add-circle' },
  { name: 'history', title: 'History', icon: 'time-outline', active: 'time' },
  { name: 'stats', title: 'Stats', icon: 'bar-chart-outline', active: 'bar-chart' },
  { name: 'health', title: 'Health', icon: 'scale-outline', active: 'scale' },
  { name: 'nutrition', title: 'Nutrition', icon: 'restaurant-outline', active: 'restaurant' },
];
export default function TabLayout() {
  const enabled = isHealthspanEnabled(); const legacyToday = isHealthV2TodayEnabled();
  const router = useRouter(); const pathname = usePathname(); const mounted = useRef(false); const insets = useSafeAreaInsets();
  // Only redirect a cold root launch. Later visits to / are the existing workout form.
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    if (enabled && pathname === '/') router.replace('/(tabs)/today' as Href);
  }, [enabled, pathname, router]);
  const visible = enabled ? v2Tabs : legacyTabs;
  const hidden = enabled ? legacyTabs : v2Tabs;
  return <Tabs initialRouteName={enabled ? 'today' : 'index'} backBehavior="history" screenOptions={{
    headerStyle: { backgroundColor: Colors.surface }, headerTintColor: Colors.text, headerShadowVisible: false,
    tabBarActiveTintColor: enabled || legacyToday ? V2Colors.primary : Colors.primary,
    tabBarInactiveTintColor: enabled || legacyToday ? V2Colors.textSecondary : Colors.textMuted,
    tabBarStyle: { backgroundColor: enabled || legacyToday ? V2Colors.surface : Colors.tabBar, borderTopColor: enabled || legacyToday ? V2Colors.divider : Colors.border, borderTopWidth: 0.5, height: 60 + insets.bottom, paddingBottom: Math.max(8, insets.bottom), paddingTop: 8 },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '600' }, tabBarHideOnKeyboard: true,
  }}>
    {visible.map(tab => <Tabs.Screen key={tab.name} name={tab.name} options={{
      title: tab.name === 'health' && legacyToday ? 'Today' : tab.title,
      headerTitle: tab.name === 'index' ? 'GainLog' : tab.title,
      headerShown: !enabled && !(tab.name === 'health' && legacyToday),
      headerRight: tab.name === 'health' ? () => <Pressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => router.push('/settings')} style={{ padding: 12 }}><Ionicons name="settings-outline" color={Colors.text} size={22} /></Pressable> : undefined,
      tabBarIcon: ({ color, size, focused }) => <Ionicons name={tab.name === 'health' && legacyToday ? focused ? 'home' : 'home-outline' : focused ? tab.active : tab.icon} size={size} color={color} />,
    }} />)}
    {hidden.map(tab => <Tabs.Screen key={tab.name} name={tab.name} options={{ href: null, title: tab.title, headerShown: enabled,
      headerLeft: enabled ? () => <Pressable accessibilityRole="button" accessibilityLabel="Return to overview" onPress={() => router.navigate((tab.name === 'nutrition' ? '/(tabs)/fuel' : tab.name === 'health' ? '/(tabs)/healthspan' : '/(tabs)/train') as Href)} style={{ padding: 12 }}><Ionicons name="arrow-back" size={24} color={Colors.text} /></Pressable> : undefined,
    }} />)}
  </Tabs>;
}
