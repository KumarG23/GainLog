import { Redirect } from 'expo-router';
import { HealthspanScreen } from '../../components/v2/HealthspanScreens';
import { isHealthspanEnabled } from '../../utils/healthspan';
export default function Route() { return isHealthspanEnabled() ? <HealthspanScreen /> : <Redirect href="/(tabs)" />; }
