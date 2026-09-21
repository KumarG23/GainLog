/** The legacy build stays unchanged unless the full Healthspan UI is explicitly enabled. */
module.exports = ({ config }) => {
  if (process.env.EXPO_PUBLIC_GAINLOG_V2_UI !== '1') return config;
  require('./scripts/brand-assets.cjs').ensureBrandAssets();
  const background = '#0B1118';
  return {
    ...config,
    icon: './assets/images/baseline-icon.png',
    android: {
      ...config.android,
      adaptiveIcon: {
        foregroundImage: './assets/images/baseline-foreground.png',
        backgroundColor: background,
        monochromeImage: './assets/images/baseline-monochrome.png',
      },
    },
    web: { ...config.web, favicon: './assets/images/baseline-favicon.png' },
    plugins: (config.plugins ?? []).map(plugin => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen'
      ? [plugin[0], { ...plugin[1], image: './assets/images/baseline-foreground.png', backgroundColor: background, dark: { backgroundColor: background } }]
      : plugin),
  };
};
