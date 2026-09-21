import React from 'react';
import { Redirect } from 'expo-router';
import { FuelScreen } from '../../components/healthspan/DomainScreens';
import { isHealthspanUIEnabled } from '../../utils/healthspan';

export default function Route() {
  return isHealthspanUIEnabled() ? <FuelScreen /> : <Redirect href="/nutrition" />;
}
