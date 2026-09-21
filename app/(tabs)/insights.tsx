import { Redirect } from 'expo-router';
import { TrendsScreen } from '../../components/v2/HealthspanScreens';
import { isHealthspanEnabled } from '../../utils/healthspan';
export default function Route() { return isHealthspanEnabled() ? <TrendsScreen /> : <Redirect href="/(tabs)" />; }
