import React from 'react';
import WorkoutScreen from './workout';
import { TodayScreen } from '../../components/healthspan/TodayScreen';
import { isHealthspanUIEnabled } from '../../utils/healthspan';

export default function HomeRoute() {
  return isHealthspanUIEnabled() ? <TodayScreen /> : <WorkoutScreen />;
}
