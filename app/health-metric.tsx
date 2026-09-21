import React from 'react';
import { Redirect } from 'expo-router';
import { MetricDetailScreen } from '../components/healthspan/TodayScreen';
import { isHealthspanUIEnabled } from '../utils/healthspan';

export default function Route() {
  return isHealthspanUIEnabled() ? <MetricDetailScreen /> : <Redirect href="/health" />;
}
