import { Redirect } from 'expo-router';
import { TodayV2 } from '../../components/TodayV2';
import { isHealthspanEnabled } from '../../utils/healthspan';
export default function TodayRoute() { return isHealthspanEnabled() ? <TodayV2 /> : <Redirect href="/(tabs)" />; }
