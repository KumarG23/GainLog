import React from 'react';
import { Redirect } from 'expo-router';
import { HealthspanScreen } from '../../components/healthspan/DomainScreens';
import { isHealthspanUIEnabled } from '../../utils/healthspan';

export default function Route() {
  return isHealthspanUIEnabled() ? <HealthspanScreen /> : <Redirect href="/health" />;
}
