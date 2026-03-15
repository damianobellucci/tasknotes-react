import '@testing-library/jest-native/extend-expect';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/',
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => false),
  shareAsync: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
    SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) => React.createElement(View, props, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});
