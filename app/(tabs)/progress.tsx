import React from 'react';
import { Redirect } from 'expo-router';
import { ProgressScreen } from '../../components/healthspan/DomainScreens';
import { isHealthspanUIEnabled } from '../../utils/healthspan';

export default function Route() {
  return isHealthspanUIEnabled() ? <ProgressScreen /> : <Redirect href="/trends" />;
}
