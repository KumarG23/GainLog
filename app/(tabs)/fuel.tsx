import { Redirect } from 'expo-router';
import { FuelScreen } from '../../components/v2/HealthspanScreens';
import { isHealthspanEnabled } from '../../utils/healthspan';
export default function Route() { return isHealthspanEnabled() ? <FuelScreen /> : <Redirect href="/(tabs)" />; }
