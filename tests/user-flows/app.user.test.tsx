import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import TaskNotesMobileScreen from '@/app/(tabs)/index';
import * as tasknotes from '@/src/tasknotes';

jest.mock('@/src/auth-cognito', () => ({
  completeNewPassword: jest.fn(),
  configureAmplify: jest.fn(),
  loginCognito: jest.fn(),
  logoutCognito: jest.fn(),
  refreshCognitoSession: jest.fn(),
}));

jest.mock('@/src/tasknotes', () => {
  const actual = jest.requireActual('@/src/tasknotes');
  return {
    ...actual,
    clearAuthSession: jest.fn(async () => {}),
    getCloudConfig: jest.fn(() => ({
      apiKey: '',
      syncUrl: '',
    })),
    loadAuthSession: jest.fn(async () => null),
    loadSnapshot: jest.fn(async () => actual.buildDefaultSnapshot()),
    saveAuthSession: jest.fn(async () => {}),
    saveSnapshot: jest.fn(async () => {}),
  };
});

describe('TaskNotes user flows', () => {
  const mockedTasknotes = tasknotes as unknown as {
    loadAuthSession: jest.Mock;
    loadSnapshot: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedTasknotes.loadSnapshot.mockResolvedValue(tasknotes.buildDefaultSnapshot());
    mockedTasknotes.loadAuthSession.mockResolvedValue(null);
  });

  it('shows login screen when there is no active session', async () => {
    const screen = render(<TaskNotesMobileScreen />);

    await screen.findByText('Cloud Login (Cognito)');

    const emailInput = screen.getByPlaceholderText('Email');
    fireEvent.changeText(emailInput, 'user@example.com');

    expect(screen.getByDisplayValue('user@example.com')).toBeTruthy();
  });

  it('lets an authenticated user create and save a task', async () => {
    mockedTasknotes.loadAuthSession.mockResolvedValue({
      accessToken: 'token',
      email: 'qa@example.com',
      expiresAt: Date.now() + 60_000,
      refreshToken: 'refresh',
    });

    const screen = render(<TaskNotesMobileScreen />);

    await screen.findByText('Task Summary');
    fireEvent.press(screen.getByLabelText('Create new task'));

    await screen.findByText('New Task');
    fireEvent.changeText(screen.getByPlaceholderText('Write a task'), 'Buy milk');
    fireEvent.press(screen.getByLabelText('Save task'));

    await waitFor(() => {
      expect(screen.getByText('Buy milk')).toBeTruthy();
    });
  });
});
