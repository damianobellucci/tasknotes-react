import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-get-random-values';
import 'react-native-reanimated';

export default function RootLayout() {
  return (
    <>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </>
  );
}
