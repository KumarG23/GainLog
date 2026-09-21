import type { ConfigContext, ExpoConfig } from 'expo/config';
export default ({ config }: ConfigContext): ExpoConfig => {
  if (process.env.EXPO_PUBLIC_GAINLOG_V2_SHELL !== '1') return config as ExpoConfig;
  // Generated locally and on EAS; no image package or lockfile change is needed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { generate } = require('./scripts/generate-healthspan-brand.cjs');
  generate();
  const asset = (name: string) => `./assets/healthspan/${name}.png`;
  return {
    ...config, name: config.name ?? 'GainLog', slug: config.slug ?? 'gainlog', icon: asset('icon'),
    android: { ...config.android, adaptiveIcon: { ...config.android?.adaptiveIcon, foregroundImage: asset('adaptive-foreground'), monochromeImage: asset('monochrome'), backgroundColor: '#0B1118', backgroundImage: undefined } },
    web: { ...config.web, favicon: asset('favicon') },
    plugins: config.plugins?.map((plugin): NonNullable<ExpoConfig['plugins']>[number] => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen'
      ? [plugin[0], { ...plugin[1], image: asset('splash'), backgroundColor: '#0B1118', dark: { ...plugin[1]?.dark, image: asset('splash'), backgroundColor: '#0B1118' } }]
      : plugin),
  };
};
