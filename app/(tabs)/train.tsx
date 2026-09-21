import React from 'react';
import { Redirect } from 'expo-router';
import { TrainScreen } from '../../components/healthspan/DomainScreens';
import { isHealthspanUIEnabled } from '../../utils/healthspan';

export default function Route() {
  return isHealthspanUIEnabled() ? <TrainScreen /> : <Redirect href="/" />;
}
