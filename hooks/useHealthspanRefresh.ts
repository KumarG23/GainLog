import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { dayKey } from '../utils/healthspan';
/** Refresh existing providers without introducing a second store or write path. */
export function useHealthspanRefresh(refresh: () => Promise<void>) {
  const [date, setDate] = useState(dayKey());
  useFocusEffect(useCallback(() => {
    let last = dayKey();
    const run = () => { last = dayKey(); setDate(last); void refresh(); };
    run();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') run(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active' && last !== dayKey()) run(); }, 60000);
    return () => { listener.remove(); clearInterval(timer); };
  }, [refresh]));
  return date;
}
