import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { WorkoutsProvider } from '../context/WorkoutsContext';
import { HealthProvider } from '../context/HealthContext';
import { Colors } from '../constants/theme';
import { MealNotificationCoordinator } from '../components/MealNotificationCoordinator';
import { HealthConnectSyncCoordinator } from '../components/HealthConnectSyncCoordinator';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <WorkoutsProvider>
      <HealthProvider>
        <MealNotificationCoordinator />
        <HealthConnectSyncCoordinator />
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: Colors.surface },
            headerTintColor: Colors.text,
            headerTitleStyle: { fontWeight: '700', color: Colors.text },
            contentStyle: { backgroundColor: Colors.background },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="session/[id]"
            options={{
              title: 'Session Detail',
              headerBackTitle: 'History',
            }}
          />
          <Stack.Screen
            name="trends"
            options={{
              title: 'Trends',
              headerBackTitle: 'Health',
            }}
          />
        </Stack>
      </HealthProvider>
    </WorkoutsProvider>
  );
}
