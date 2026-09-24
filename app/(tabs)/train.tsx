import { Redirect } from 'expo-router';
import { TrainScreen } from '../../components/v2/HealthspanScreens';
import { isHealthspanEnabled } from '../../utils/healthspan';
export default function Route() { return isHealthspanEnabled() ? <TrainScreen /> : <Redirect href="/(tabs)" />; }
