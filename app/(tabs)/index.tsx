import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
    completeNewPassword,
    configureAmplify,
    loginCognito,
    logoutCognito,
    refreshCognitoSession,
} from '@/src/auth-cognito';
import { mergeSnapshots } from '@/src/merge-service';
import {
    type AnyItem,
    type AppSnapshot,
    type AuthSession,
    type ItemType,
    type NoteSortMode,
    type TaskFilter,
    type TaskSortMode,
    addTag,
    buildDefaultSnapshot,
    clearAuthSession,
    createNote,
    createSyncBaseline,
    createTask,
    getCloudConfig,
    hasUnsyncedChanges,
    loadAuthSession,
    loadSnapshot,
    normalizeTag,
    removeTag,
    sanitizeSnapshot,
    saveAuthSession,
    saveSnapshot,
    sortItems,
    withResequencedManualOrder,
} from '@/src/tasknotes';

type MainView = 'tasks' | 'notes' | 'trash';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type UndoState = {
  type: ItemType;
  id: string;
  prevDeletedAt: string | null;
  expiresAt: number;
};

const CLOUD_SYNC_INTERVAL_MS = 15000;

function ItemTextEditor({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (nextValue: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onBlur={() => onCommit(draft)}
      multiline
      placeholder={placeholder}
      placeholderTextColor="#97A9B8"
      style={styles.itemTextInput}
    />
  );
}

function SortChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.sortChip, active && styles.sortChipActive]}>
      <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '-';
  }
  const dt = new Date(iso);
  if (Number.isNaN(dt.valueOf())) {
    return '-';
  }
  return dt.toLocaleString();
}

function getMissingCognitoEnv(): string[] {
  const missing: string[] = [];
  if (!(process.env.EXPO_PUBLIC_COGNITO_REGION ?? '').trim()) {
    missing.push('EXPO_PUBLIC_COGNITO_REGION');
  }
  if (!(process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID ?? '').trim()) {
    missing.push('EXPO_PUBLIC_COGNITO_CLIENT_ID');
  }
  return missing;
}

export default function TaskNotesMobileScreen() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(buildDefaultSnapshot());
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [mainView, setMainView] = useState<MainView>('tasks');
  const [searchText, setSearchText] = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all');
  const [newTaskText, setNewTaskText] = useState('');
  const [newNoteText, setNewNoteText] = useState('');
  const [newGlobalTag, setNewGlobalTag] = useState('');
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [cloudStatus, setCloudStatus] = useState('Local only');
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authEmailInput, setAuthEmailInput] = useState('');
  const [authPasswordInput, setAuthPasswordInput] = useState('');
  const [authNewPasswordInput, setAuthNewPasswordInput] = useState('');
  const [authChallengeSession, setAuthChallengeSession] = useState('');
  const [newPasswordRequired, setNewPasswordRequired] = useState(false);
  const [cognitoConfigured, setCognitoConfigured] = useState(false);
  const [authStatusText, setAuthStatusText] = useState('Manual session');
  const [lastConflictCount, setLastConflictCount] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotRef = useRef<AppSnapshot>(buildDefaultSnapshot());
  const authSessionRef = useRef<AuthSession | null>(null);
  const cloudSyncInFlightRef = useRef(false);
  const cloudSyncPendingPushRef = useRef(false);
  const cloudPullTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cloudRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudLastSnapshotHashRef = useRef('');

  const cloudConfig = useMemo(() => getCloudConfig(), []);
  const cloudSyncEnabled = !!cloudConfig.syncUrl && (!!cloudConfig.apiKey || !!authSession?.accessToken);

  useEffect(() => {
    const region = process.env.EXPO_PUBLIC_COGNITO_REGION ?? '';
    const clientId = process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID ?? '';
    const missing = getMissingCognitoEnv();
    if (!missing.length) {
      configureAmplify(region, clientId);
      setCognitoConfigured(true);
      setAuthStatusText('Cognito configured');
    } else {
      setCognitoConfigured(false);
      setAuthStatusText(`Cognito missing config: ${missing.join(', ')}`);
    }
  }, []);

  useEffect(() => {
    async function hydrate() {
      const [loaded, session] = await Promise.all([loadSnapshot(), loadAuthSession()]);
      setSnapshot(sanitizeSnapshot(loaded));
      setAuthSession(session);
      if (session) {
        setAuthEmailInput(session.email);
      }
      setHydrated(true);
      if (cloudConfig.syncUrl) {
        setCloudStatus('Cloud configured');
      }
    }
    hydrate();
  }, [cloudConfig.syncUrl]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }
    setSaveState('saving');
    saveTimer.current = setTimeout(async () => {
      try {
        await saveSnapshot(snapshot);
        setSaveState('saved');
        setSaveError('');
      } catch (err) {
        setSaveState('error');
        setSaveError((err as Error).message);
      }
    }, 450);

    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, [snapshot, hydrated]);

  useEffect(() => {
    if (!undoState) {
      return;
    }
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
    }
    const delay = Math.max(0, undoState.expiresAt - Date.now());
    undoTimer.current = setTimeout(() => setUndoState(null), delay);
    return () => {
      if (undoTimer.current) {
        clearTimeout(undoTimer.current);
      }
    };
  }, [undoState]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    authSessionRef.current = authSession;
  }, [authSession]);

  const activeTasks = useMemo(() => snapshot.tasks.filter((item) => !item.isDeleted), [snapshot.tasks]);
  const activeNotes = useMemo(() => snapshot.notes.filter((item) => !item.isDeleted), [snapshot.notes]);

  const filteredTasks = useMemo(() => {
    const lowered = searchText.trim().toLowerCase();
    const base = activeTasks.filter((item) => {
      if (taskFilter === 'open' && item.done) return false;
      if (taskFilter === 'done' && !item.done) return false;
      if (tagFilter !== 'all' && !item.tags.some((tag) => tag.toLowerCase() === tagFilter.toLowerCase())) {
        return false;
      }
      if (!lowered) return true;
      return item.text.toLowerCase().includes(lowered) || item.tags.some((tag) => tag.toLowerCase().includes(lowered));
    });
    return sortItems(base, snapshot.settings.taskSort);
  }, [activeTasks, searchText, tagFilter, taskFilter, snapshot.settings.taskSort]);

  const filteredNotes = useMemo(() => {
    const lowered = searchText.trim().toLowerCase();
    const base = activeNotes.filter((item) => {
      if (tagFilter !== 'all' && !item.tags.some((tag) => tag.toLowerCase() === tagFilter.toLowerCase())) {
        return false;
      }
      if (!lowered) return true;
      return item.text.toLowerCase().includes(lowered) || item.tags.some((tag) => tag.toLowerCase().includes(lowered));
    });
    return sortItems(base, snapshot.settings.noteSort);
  }, [activeNotes, searchText, tagFilter, snapshot.settings.noteSort]);

  const trashItems = useMemo(() => {
    const merged: AnyItem[] = [...snapshot.tasks, ...snapshot.notes].filter((item) => item.isDeleted);
    merged.sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
    return merged;
  }, [snapshot.tasks, snapshot.notes]);

  const taskSummary = useMemo(() => {
    const open = activeTasks.filter((task) => !task.done);
    const byPriority = new Array<number>(10).fill(0);
    open.forEach((task) => {
      byPriority[task.priority - 1] += 1;
    });
    return { openCount: open.length, byPriority };
  }, [activeTasks]);

  const manualTaskReorderEnabled =
    mainView === 'tasks' &&
    snapshot.settings.taskSort === 'manual' &&
    searchText.trim().length === 0 &&
    tagFilter === 'all' &&
    taskFilter === 'all';

  const manualNoteReorderEnabled =
    mainView === 'notes' &&
    snapshot.settings.noteSort === 'manual' &&
    searchText.trim().length === 0 &&
    tagFilter === 'all';

  function moveManualOrder<T extends AnyItem>(items: T[], itemId: string, direction: -1 | 1): T[] {
    const manualItems = [...items].sort((a, b) => a.manualOrder - b.manualOrder);
    const fromIndex = manualItems.findIndex((item) => item.id === itemId);
    if (fromIndex < 0) {
      return manualItems;
    }
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= manualItems.length) {
      return manualItems;
    }
    const next = [...manualItems];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return withResequencedManualOrder(next);
  }

  function addTaskItem() {
    const text = newTaskText.trim();
    if (!text) {
      return;
    }
    setSnapshot((prev) => ({
      ...prev,
      tasks: [...prev.tasks, createTask(text, prev.tasks.length)],
    }));
    setNewTaskText('');
  }

  function addNoteItem() {
    const text = newNoteText.trim();
    if (!text) {
      return;
    }
    setSnapshot((prev) => ({
      ...prev,
      notes: [...prev.notes, createNote(text, prev.notes.length)],
    }));
    setNewNoteText('');
  }

  function setTaskSort(mode: TaskSortMode) {
    setSnapshot((prev) => ({
      ...prev,
      settings: { ...prev.settings, taskSort: mode },
    }));
  }

  function setNoteSort(mode: NoteSortMode) {
    setSnapshot((prev) => ({
      ...prev,
      settings: { ...prev.settings, noteSort: mode },
    }));
  }

  function softDelete(item: AnyItem) {
    const deletedAt = new Date().toISOString();
    setSnapshot((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        item.type === 'task' && task.id === item.id ? { ...task, isDeleted: true, deletedAt, updatedAt: deletedAt } : task
      ),
      notes: prev.notes.map((note) =>
        item.type === 'note' && note.id === item.id ? { ...note, isDeleted: true, deletedAt, updatedAt: deletedAt } : note
      ),
    }));
    setUndoState({ type: item.type, id: item.id, prevDeletedAt: item.deletedAt, expiresAt: Date.now() + 5000 });
  }

  function undoDelete() {
    if (!undoState) {
      return;
    }
    setSnapshot((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        undoState.type === 'task' && task.id === undoState.id
          ? { ...task, isDeleted: false, deletedAt: undoState.prevDeletedAt }
          : task
      ),
      notes: prev.notes.map((note) =>
        undoState.type === 'note' && note.id === undoState.id
          ? { ...note, isDeleted: false, deletedAt: undoState.prevDeletedAt }
          : note
      ),
    }));
    setUndoState(null);
  }

  function restoreFromTrash(item: AnyItem) {
    setSnapshot((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) => (item.type === 'task' && task.id === item.id ? { ...task, isDeleted: false, deletedAt: null } : task)),
      notes: prev.notes.map((note) => (item.type === 'note' && note.id === item.id ? { ...note, isDeleted: false, deletedAt: null } : note)),
    }));
  }

  function addGlobalTag() {
    const tag = normalizeTag(newGlobalTag);
    if (!tag) {
      return;
    }
    setSnapshot((prev) => ({
      ...prev,
      tags: addTag(prev.tags, tag),
    }));
    setNewGlobalTag('');
  }

  function assignTagToItem(item: AnyItem, tag: string) {
    setSnapshot((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        item.type === 'task' && task.id === item.id
          ? {
              ...task,
              tags: addTag(task.tags, tag),
              updatedAt: new Date().toISOString(),
            }
          : task
      ),
      notes: prev.notes.map((note) =>
        item.type === 'note' && note.id === item.id
          ? {
              ...note,
              tags: addTag(note.tags, tag),
              updatedAt: new Date().toISOString(),
            }
          : note
      ),
    }));
  }

  function removeTagFromItem(item: AnyItem, tag: string) {
    setSnapshot((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        item.type === 'task' && task.id === item.id
          ? {
              ...task,
              tags: removeTag(task.tags, tag),
              updatedAt: new Date().toISOString(),
            }
          : task
      ),
      notes: prev.notes.map((note) =>
        item.type === 'note' && note.id === item.id
          ? {
              ...note,
              tags: removeTag(note.tags, tag),
              updatedAt: new Date().toISOString(),
            }
          : note
      ),
    }));
  }

  function removeGlobalTag(tag: string) {
    setSnapshot((prev) => ({
      ...prev,
      tags: removeTag(prev.tags, tag),
      tasks: prev.tasks.map((task) => ({ ...task, tags: removeTag(task.tags, tag) })),
      notes: prev.notes.map((note) => ({ ...note, tags: removeTag(note.tags, tag) })),
    }));
    if (tagFilter.toLowerCase() === tag.toLowerCase()) {
      setTagFilter('all');
    }
  }

  function updateText(item: AnyItem, nextText: string) {
    const trimmed = nextText.trim();
    if (!trimmed) {
      return;
    }
    const now = new Date().toISOString();
    setSnapshot((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        item.type === 'task' && task.id === item.id
          ? {
              ...task,
              text: trimmed,
              updatedAt: now,
              editCount: task.text === trimmed ? task.editCount : task.editCount + 1,
            }
          : task
      ),
      notes: prev.notes.map((note) =>
        item.type === 'note' && note.id === item.id
          ? {
              ...note,
              text: trimmed,
              updatedAt: now,
              editCount: note.text === trimmed ? note.editCount : note.editCount + 1,
            }
          : note
      ),
    }));
  }

  async function exportData() {
    try {
      const payload = JSON.stringify(snapshot, null, 2);
      const fileUri = `${FileSystem.documentDirectory}tasknotes-export-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(fileUri, payload, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await Sharing.shareAsync(fileUri, {
        dialogTitle: 'Export TaskNotes JSON',
      });
    } catch (err) {
      Alert.alert('Export failed', (err as Error).message);
    }
  }

  async function importData() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets.length) {
        return;
      }
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const parsed = JSON.parse(content) as AppSnapshot;
      setSnapshot(sanitizeSnapshot(parsed));
      Alert.alert('Import completed', 'JSON data loaded successfully.');
    } catch (err) {
      Alert.alert('Import failed', (err as Error).message);
    }
  }

  async function cloudPush(sourceSnapshot?: AppSnapshot, baseServerUpdatedAt = '') {
    if (!cloudConfig.syncUrl || (!cloudConfig.apiKey && !authSessionRef.current?.accessToken)) {
      return;
    }
    if (cloudSyncInFlightRef.current) {
      cloudSyncPendingPushRef.current = true;
      return;
    }
    const localSnapshot = sourceSnapshot ?? snapshotRef.current;
    const snapshotHash = JSON.stringify(localSnapshot);
    cloudSyncInFlightRef.current = true;
    setCloudStatus('Cloud syncing...');
    try {
      const res = await fetch(`${cloudConfig.syncUrl}/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cloudConfig.apiKey ? { 'x-api-key': cloudConfig.apiKey } : {}),
          ...(!cloudConfig.apiKey && authSessionRef.current?.accessToken
            ? { Authorization: `Bearer ${authSessionRef.current.accessToken}` }
            : {}),
        },
        body: JSON.stringify({
          snapshot: localSnapshot,
          clientUpdatedAt: new Date().toISOString(),
          baseServerUpdatedAt: baseServerUpdatedAt || localSnapshot.sync.serverUpdatedAt,
        }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          const conflictPayload = (await res.json()) as {
            snapshot?: AppSnapshot;
            serverUpdatedAt?: string;
          };
          if (conflictPayload.snapshot) {
            const remote = sanitizeSnapshot(conflictPayload.snapshot);
            const base = localSnapshot.sync.lastSyncedSnapshot;
            const result = mergeSnapshots(base, localSnapshot, remote);
            result.merged.sync.serverUpdatedAt = conflictPayload.serverUpdatedAt ?? localSnapshot.sync.serverUpdatedAt;
            result.merged.sync.lastSyncedSnapshot = createSyncBaseline(result.merged);
            setSnapshot(sanitizeSnapshot(result.merged));
            setLastConflictCount(result.conflicts.length);
            setCloudStatus('Cloud conflict merged locally, retrying sync...');
            queueCloudPush(result.merged);
            return;
          }
        }
        if (res.status === 429) {
          setCloudStatus('Cloud sync throttled, retrying soon...');
          scheduleCloudRetry(5000);
          return;
        }
        scheduleCloudRetry(15000);
        throw new Error(`Push failed with status ${res.status}`);
      }
      const payload = (await res.json()) as { ok: boolean; serverUpdatedAt?: string };
      if (!payload.ok) {
        scheduleCloudRetry(15000);
        throw new Error('Push did not succeed');
      }
      clearCloudRetry();
      cloudLastSnapshotHashRef.current = snapshotHash;
      setSnapshot((prev) => ({
        ...prev,
        sync: {
          ...prev.sync,
          serverUpdatedAt: payload.serverUpdatedAt ?? prev.sync.serverUpdatedAt,
          lastSyncedSnapshot: createSyncBaseline(prev),
        },
      }));
      setLastConflictCount(0);
      setCloudStatus(`Cloud sincronizzato ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      setCloudStatus(`Cloud sync pending: ${(err as Error).message}`);
      scheduleCloudRetry(15000);
    } finally {
      cloudSyncInFlightRef.current = false;
      if (cloudSyncPendingPushRef.current) {
        cloudSyncPendingPushRef.current = false;
        const nextSnapshot = snapshotRef.current;
        void cloudPush(nextSnapshot, nextSnapshot.sync.serverUpdatedAt || '');
      }
    }
  }

  async function cloudPull() {
    if (!cloudConfig.syncUrl || (!cloudConfig.apiKey && !authSessionRef.current?.accessToken) || cloudSyncInFlightRef.current) {
      return;
    }
    cloudSyncInFlightRef.current = true;
    try {
      const currentSnapshot = snapshotRef.current;
      const since = encodeURIComponent(currentSnapshot.sync.serverUpdatedAt || new Date(0).toISOString());
      const res = await fetch(`${cloudConfig.syncUrl}/sync/pull?since=${since}`, {
        method: 'GET',
        headers: {
          ...(cloudConfig.apiKey ? { 'x-api-key': cloudConfig.apiKey } : {}),
          ...(!cloudConfig.apiKey && authSessionRef.current?.accessToken
            ? { Authorization: `Bearer ${authSessionRef.current.accessToken}` }
            : {}),
        },
      });
      if (!res.ok) {
        if (res.status === 429) {
          setCloudStatus('Cloud sync throttled, retrying later...');
          return;
        }
        throw new Error(`Pull failed with status ${res.status}`);
      }
      const payload = (await res.json()) as {
        ok: boolean;
        snapshot?: AppSnapshot;
        serverUpdatedAt?: string;
      };
      if (!payload.ok || !payload.snapshot) {
        throw new Error('Pull did not return snapshot');
      }
      const remote = sanitizeSnapshot(payload.snapshot);
      const base = currentSnapshot.sync.lastSyncedSnapshot;
      const result = mergeSnapshots(base, currentSnapshot, remote);
      result.merged.sync.serverUpdatedAt = payload.serverUpdatedAt ?? remote.sync.serverUpdatedAt;
      result.merged.sync.lastSyncedSnapshot = createSyncBaseline(result.merged);
      setSnapshot(sanitizeSnapshot(result.merged));
      setLastConflictCount(result.conflicts.length);
      if (result.conflicts.length) {
        setCloudStatus('Cloud conflict merged locally, sync pending');
        queueCloudPush(result.merged);
        return;
      }
      if (hasUnsyncedChanges(result.merged)) {
        setCloudStatus('Cloud changes merged locally, sync pending');
        queueCloudPush(result.merged);
        return;
      }
      setCloudStatus(`Cloud sincronizzato ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      // Desktop keeps local app usable when background pull fails.
      // Keep previous cloud status to avoid noisy transient errors.
      void err;
    } finally {
      cloudSyncInFlightRef.current = false;
    }
  }

  async function loginWithCognito() {
    if (!cognitoConfigured) {
      const missing = getMissingCognitoEnv();
      const details = missing.length ? missing.join(', ') : 'Unknown configuration issue';
      setAuthStatusText(`Login blocked: missing ${details}`);
      Alert.alert('Cognito not configured', `Set: ${details}`);
      return;
    }
    const email = authEmailInput.trim();
    const password = authPasswordInput.trim();
    if (!email || !password) {
      setAuthStatusText('Login blocked: email and password required');
      Alert.alert('Invalid auth', 'Insert both email and password.');
      return;
    }
    setAuthStatusText('Logging in...');
    try {
      const result = await loginCognito(email, password);
      if (result.newPasswordRequired) {
        setNewPasswordRequired(true);
        setAuthChallengeSession(result.session ?? '');
        setAuthStatusText('New password required');
        return;
      }
      if (!result.ok || !result.authSession) {
        throw new Error(result.error || 'Login failed');
      }
      const next = {
        email: result.authSession.email,
        accessToken: result.authSession.accessToken,
        refreshToken: result.authSession.refreshToken,
        expiresAt: result.authSession.expiresAt,
      };
      await saveAuthSession(next);
      setAuthSession(next);
      setNewPasswordRequired(false);
      setAuthChallengeSession('');
      setAuthStatusText('Cognito login success');
      setCloudStatus(`Authenticated as ${next.email}`);
    } catch (err) {
      const message = (err as Error).message;
      setAuthStatusText(`Login failed: ${message}`);
      setCloudStatus(`Auth error: ${message}`);
      Alert.alert('Login failed', message);
    }
  }

  async function completeCognitoNewPassword() {
    const email = authEmailInput.trim();
    const newPassword = authNewPasswordInput.trim();
    if (!email || !newPassword || !authChallengeSession) {
      setAuthStatusText('New password blocked: required fields missing');
      Alert.alert('Invalid input', 'Email, new password and Cognito challenge session are required.');
      return;
    }
    setAuthStatusText('Completing new password...');
    try {
      const result = await completeNewPassword(email, newPassword, authChallengeSession);
      if (!result.ok || !result.authSession) {
        throw new Error(result.error || 'Password update failed');
      }
      const next = {
        email: result.authSession.email,
        accessToken: result.authSession.accessToken,
        refreshToken: result.authSession.refreshToken,
        expiresAt: result.authSession.expiresAt,
      };
      await saveAuthSession(next);
      setAuthSession(next);
      setNewPasswordRequired(false);
      setAuthNewPasswordInput('');
      setAuthChallengeSession('');
      setAuthStatusText('Password updated');
      setCloudStatus(`Authenticated as ${next.email}`);
    } catch (err) {
      const message = (err as Error).message;
      setAuthStatusText(`New password failed: ${message}`);
      Alert.alert('New password failed', message);
    }
  }

  async function refreshCognitoAuth() {
    setAuthStatusText('Refreshing token...');
    try {
      const refreshToken = authSession?.refreshToken ?? '';
      const result = await refreshCognitoSession(refreshToken, authEmailInput.trim());
      if (!result.ok || !result.authSession) {
        throw new Error(result.error || 'Refresh failed');
      }
      const next = {
        email: result.authSession.email || authEmailInput.trim(),
        accessToken: result.authSession.accessToken,
        refreshToken: result.authSession.refreshToken,
        expiresAt: result.authSession.expiresAt,
      };
      await saveAuthSession(next);
      setAuthSession(next);
      setAuthStatusText('Token refreshed');
      setCloudStatus(`Token refreshed at ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      const message = (err as Error).message;
      setAuthStatusText(`Refresh failed: ${message}`);
      Alert.alert('Refresh failed', message);
    }
  }

  async function logoutAuth(force = false) {
    if (!force && hasUnsyncedChanges(snapshotRef.current)) {
      Alert.alert(
        'Unsynced local changes',
        'You have local changes not synced to cloud. If you logout now they will be lost. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Logout', style: 'destructive', onPress: () => void logoutAuth(true) },
        ]
      );
      return;
    }
    try {
      if (cognitoConfigured) {
        await logoutCognito();
      }
    } catch {
      // Keep local logout behavior also when Cognito sign-out fails.
    }
    await clearAuthSession();
    setAuthSession(null);
    authSessionRef.current = null;
    setAuthPasswordInput('');
    setAuthNewPasswordInput('');
    setAuthChallengeSession('');
    setNewPasswordRequired(false);
    setSnapshot(buildDefaultSnapshot());
    cloudLastSnapshotHashRef.current = '';
    clearCloudRetry();
    if (cloudPullTimerRef.current) {
      clearInterval(cloudPullTimerRef.current);
      cloudPullTimerRef.current = null;
    }
    setAuthStatusText('Logged out');
    setCloudStatus('Local only');
  }

  function renderTask(item: AnyItem) {
    if (item.type !== 'task') {
      return null;
    }
    const disabledReorder = !manualTaskReorderEnabled;
    return (
      <View key={item.id} style={styles.itemCard}>
        <View style={styles.itemRow}>
          <Pressable
            onPress={() =>
              setSnapshot((prev) => ({
                ...prev,
                tasks: prev.tasks.map((task) =>
                  task.id === item.id
                    ? {
                        ...task,
                        done: !task.done,
                        updatedAt: new Date().toISOString(),
                      }
                    : task
                ),
              }))
            }
            style={[styles.checkbox, item.done && styles.checkboxChecked]}>
            <Text style={styles.checkboxText}>{item.done ? '✓' : ''}</Text>
          </Pressable>
          <Pressable
            disabled={disabledReorder}
            onPress={() =>
              setSnapshot((prev) => ({
                ...prev,
                tasks: moveManualOrder(
                  prev.tasks.filter((entry) => !entry.isDeleted),
                  item.id,
                  -1
                ).concat(prev.tasks.filter((entry) => entry.isDeleted)),
              }))
            }
            style={styles.dragHandle}>
            <Text style={[styles.dragHandleText, disabledReorder && styles.dragDisabled]}>↑</Text>
          </Pressable>
          <Pressable
            disabled={disabledReorder}
            onPress={() =>
              setSnapshot((prev) => ({
                ...prev,
                tasks: moveManualOrder(
                  prev.tasks.filter((entry) => !entry.isDeleted),
                  item.id,
                  1
                ).concat(prev.tasks.filter((entry) => entry.isDeleted)),
              }))
            }
            style={styles.dragHandle}>
            <Text style={[styles.dragHandleText, disabledReorder && styles.dragDisabled]}>↓</Text>
          </Pressable>
          <View style={styles.priorityWrap}>
            <Text style={styles.priorityLabel}>P{item.priority}</Text>
            <View style={styles.priorityButtons}>
              <Pressable
                onPress={() =>
                  setSnapshot((prev) => ({
                    ...prev,
                    tasks: prev.tasks.map((task) =>
                      task.id === item.id
                        ? { ...task, priority: Math.max(1, task.priority - 1), updatedAt: new Date().toISOString() }
                        : task
                    ),
                  }))
                }>
                <Text style={styles.priorityBtn}>-</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  setSnapshot((prev) => ({
                    ...prev,
                    tasks: prev.tasks.map((task) =>
                      task.id === item.id
                        ? { ...task, priority: Math.min(10, task.priority + 1), updatedAt: new Date().toISOString() }
                        : task
                    ),
                  }))
                }>
                <Text style={styles.priorityBtn}>+</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <ItemTextEditor
          value={item.text}
          placeholder="Task text"
          onCommit={(nextValue) => updateText(item, nextValue)}
        />

        <View style={styles.tagsRow}>
          {item.tags.map((tag) => (
            <Pressable key={tag} style={styles.tagChip} onPress={() => removeTagFromItem(item, tag)}>
              <Text style={styles.tagText}>#{tag} ×</Text>
            </Pressable>
          ))}
          {snapshot.tags
            .filter((tag) => !item.tags.some((own) => own.toLowerCase() === tag.toLowerCase()))
            .slice(0, 4)
            .map((tag) => (
              <Pressable key={`a-${item.id}-${tag}`} style={styles.tagChipAdd} onPress={() => assignTagToItem(item, tag)}>
                <Text style={styles.tagTextAdd}>+ #{tag}</Text>
              </Pressable>
            ))}
        </View>

        <Text style={styles.metaText}>
          Created {formatDate(item.createdAt)} | Updated {formatDate(item.updatedAt)} | Edits {item.editCount}
        </Text>

        <Pressable onPress={() => softDelete(item)} style={styles.deleteButton}>
          <Text style={styles.deleteButtonText}>Delete</Text>
        </Pressable>
      </View>
    );
  }

  function renderNoteCard(item: AnyItem) {
    return (
      <View key={item.id} style={styles.itemCard}>
        <View style={styles.itemRow}>
          <Pressable
            disabled={!manualNoteReorderEnabled}
            onPress={() =>
              setSnapshot((prev) => ({
                ...prev,
                notes: moveManualOrder(
                  prev.notes.filter((entry) => !entry.isDeleted),
                  item.id,
                  -1
                ).concat(prev.notes.filter((entry) => entry.isDeleted)),
              }))
            }
            style={styles.dragHandle}>
            <Text style={[styles.dragHandleText, !manualNoteReorderEnabled && styles.dragDisabled]}>↑</Text>
          </Pressable>
          <Pressable
            disabled={!manualNoteReorderEnabled}
            onPress={() =>
              setSnapshot((prev) => ({
                ...prev,
                notes: moveManualOrder(
                  prev.notes.filter((entry) => !entry.isDeleted),
                  item.id,
                  1
                ).concat(prev.notes.filter((entry) => entry.isDeleted)),
              }))
            }
            style={styles.dragHandle}>
            <Text style={[styles.dragHandleText, !manualNoteReorderEnabled && styles.dragDisabled]}>↓</Text>
          </Pressable>
        </View>

        <ItemTextEditor
          value={item.text}
          placeholder="Note text"
          onCommit={(nextValue) => updateText(item, nextValue)}
        />

        <View style={styles.tagsRow}>
          {item.tags.map((tag) => (
            <Pressable key={tag} style={styles.tagChip} onPress={() => removeTagFromItem(item, tag)}>
              <Text style={styles.tagText}>#{tag} ×</Text>
            </Pressable>
          ))}
          {snapshot.tags
            .filter((tag) => !item.tags.some((own) => own.toLowerCase() === tag.toLowerCase()))
            .slice(0, 4)
            .map((tag) => (
              <Pressable key={`a-${item.id}-${tag}`} style={styles.tagChipAdd} onPress={() => assignTagToItem(item, tag)}>
                <Text style={styles.tagTextAdd}>+ #{tag}</Text>
              </Pressable>
            ))}
        </View>

        <Text style={styles.metaText}>
          Created {formatDate(item.createdAt)} | Updated {formatDate(item.updatedAt)} | Edits {item.editCount}
        </Text>

        <Pressable onPress={() => softDelete(item)} style={styles.deleteButton}>
          <Text style={styles.deleteButtonText}>Delete</Text>
        </Pressable>
      </View>
    );
  }

  const syncPending = hasUnsyncedChanges(snapshot);

  function clearCloudRetry() {
    if (!cloudRetryTimerRef.current) {
      return;
    }
    clearTimeout(cloudRetryTimerRef.current);
    cloudRetryTimerRef.current = null;
  }

  function scheduleCloudRetry(delayMs: number) {
    clearCloudRetry();
    cloudRetryTimerRef.current = setTimeout(() => {
      cloudRetryTimerRef.current = null;
      const currentSnapshot = snapshotRef.current;
      void cloudPush(currentSnapshot, currentSnapshot.sync.serverUpdatedAt || '');
    }, delayMs);
  }

  function queueCloudPush(nextSnapshot?: AppSnapshot) {
    const currentSnapshot = nextSnapshot ?? snapshotRef.current;
    if (!hasUnsyncedChanges(currentSnapshot)) {
      return;
    }
    const snapshotHash = JSON.stringify(currentSnapshot);
    if (snapshotHash === cloudLastSnapshotHashRef.current) {
      return;
    }
    void cloudPush(currentSnapshot, currentSnapshot.sync.serverUpdatedAt || '');
  }

  useEffect(() => {
    if (!hydrated || !cloudSyncEnabled) {
      if (cloudPullTimerRef.current) {
        clearInterval(cloudPullTimerRef.current);
        cloudPullTimerRef.current = null;
      }
      clearCloudRetry();
      return;
    }

    const startSync = async () => {
      await cloudPull();
      if (hasUnsyncedChanges(snapshotRef.current)) {
        queueCloudPush(snapshotRef.current);
      }
    };

    void startSync();

    if (cloudPullTimerRef.current) {
      clearInterval(cloudPullTimerRef.current);
    }
    cloudPullTimerRef.current = setInterval(() => {
      void cloudPull();
    }, CLOUD_SYNC_INTERVAL_MS);

    return () => {
      if (cloudPullTimerRef.current) {
        clearInterval(cloudPullTimerRef.current);
        cloudPullTimerRef.current = null;
      }
      clearCloudRetry();
    };
  }, [hydrated, cloudSyncEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hydrated || !cloudSyncEnabled) {
      return;
    }
    queueCloudPush(snapshot);
  }, [snapshot, hydrated, cloudSyncEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>TaskNotes Mobile</Text>
        <Text style={styles.subtitle}>React Native app aligned with TaskNotes Electron features</Text>
      </View>

      <View style={styles.segmentRow}>
        <SortChip label="Tasks" active={mainView === 'tasks'} onPress={() => setMainView('tasks')} />
        <SortChip label="Notes" active={mainView === 'notes'} onPress={() => setMainView('notes')} />
        <SortChip label="Trash" active={mainView === 'trash'} onPress={() => setMainView('trash')} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollBody}>
        <View style={styles.utilityCard}>
          <Text style={styles.sectionTitle}>Status</Text>
          <Text style={styles.statusLine}>
            Save:{' '}
            {saveState === 'error'
              ? `Error (${saveError || 'unknown'})`
              : saveState === 'saving'
                ? 'Saving...'
                : saveState === 'saved'
                  ? 'All changes saved'
                  : 'Idle'}
          </Text>
          <Text style={styles.statusLine}>Cloud: {cloudStatus}</Text>
          <Text style={styles.statusLine}>Auth: {authSession ? authSession.email : 'Not authenticated'}</Text>
          <Text style={styles.statusLine}>
            Token expiry: {authSession?.expiresAt ? formatDate(new Date(authSession.expiresAt).toISOString()) : '-'}
          </Text>
          <Text style={styles.statusLine}>Conflicts last sync: {lastConflictCount}</Text>
          <Text style={styles.statusLine}>Sync pending: {syncPending ? 'Yes' : 'No'}</Text>
        </View>

        <View style={styles.utilityCard}>
          <Text style={styles.sectionTitle}>Cloud Auth Session (Cognito)</Text>
          <Text style={styles.metaText}>Status: {authStatusText}</Text>
          <TextInput
            value={authEmailInput}
            onChangeText={setAuthEmailInput}
            placeholder="Email"
            autoCapitalize="none"
            placeholderTextColor="#97A9B8"
            style={styles.input}
          />
          <TextInput
            value={authPasswordInput}
            onChangeText={setAuthPasswordInput}
            placeholder="Password"
            autoCapitalize="none"
            secureTextEntry
            placeholderTextColor="#97A9B8"
            style={styles.input}
          />
          {newPasswordRequired && (
            <TextInput
              value={authNewPasswordInput}
              onChangeText={setAuthNewPasswordInput}
              placeholder="New password required"
              autoCapitalize="none"
              secureTextEntry
              placeholderTextColor="#97A9B8"
              style={styles.input}
            />
          )}
          <View style={styles.rowGap10}>
            <Pressable style={styles.secondaryButton} onPress={loginWithCognito}>
              <Text style={styles.secondaryButtonText}>Login</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={refreshCognitoAuth}>
              <Text style={styles.secondaryButtonText}>Refresh Token</Text>
            </Pressable>
            {newPasswordRequired && (
              <Pressable style={styles.secondaryButton} onPress={completeCognitoNewPassword}>
                <Text style={styles.secondaryButtonText}>Set New Password</Text>
              </Pressable>
            )}
            <Pressable style={styles.secondaryButton} onPress={logoutAuth}>
              <Text style={styles.secondaryButtonText}>Logout</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.utilityCard}>
          <Text style={styles.sectionTitle}>Global Tools</Text>
          <View style={styles.rowGap10}>
            <Pressable style={styles.secondaryButton} onPress={importData}>
              <Text style={styles.secondaryButtonText}>Import JSON</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={exportData}>
              <Text style={styles.secondaryButtonText}>Export JSON</Text>
            </Pressable>
          </View>
          <TextInput
            value={newGlobalTag}
            onChangeText={setNewGlobalTag}
            onSubmitEditing={addGlobalTag}
            placeholder="Create global tag"
            placeholderTextColor="#97A9B8"
            style={styles.input}
          />
          <View style={styles.tagsRow}>
            <SortChip label="All tags" active={tagFilter === 'all'} onPress={() => setTagFilter('all')} />
            {snapshot.tags.map((tag) => (
              <View key={tag} style={styles.globalTagWrap}>
                <Pressable onPress={() => setTagFilter(tag)}>
                  <Text style={[styles.globalTagText, tagFilter === tag && styles.globalTagTextActive]}>
                    #{tag}
                  </Text>
                </Pressable>
                <Pressable onPress={() => removeGlobalTag(tag)}>
                  <Text style={styles.removeTagText}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.utilityCard}>
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search text or tags"
            placeholderTextColor="#97A9B8"
            style={styles.input}
          />
        </View>

        {mainView === 'tasks' && (
          <View style={styles.sectionWrap}>
            <Text style={styles.sectionTitle}>Task Summary</Text>
            <Text style={styles.metaText}>Open tasks: {taskSummary.openCount}</Text>
            <View style={styles.prioritySummaryWrap}>
              {taskSummary.byPriority.map((count, idx) => (
                <Text key={`p-${idx + 1}`} style={styles.prioritySummaryText}>
                  P{idx + 1}: {count}
                </Text>
              ))}
            </View>

            <Text style={styles.sectionTitle}>New Task</Text>
            <TextInput
              value={newTaskText}
              onChangeText={setNewTaskText}
              onSubmitEditing={addTaskItem}
              placeholder="Write a task and press Enter"
              placeholderTextColor="#97A9B8"
              style={styles.input}
            />
            <Pressable style={styles.primaryButton} onPress={addTaskItem}>
              <Text style={styles.primaryButtonText}>Add Task</Text>
            </Pressable>

            <View style={styles.sortRow}>
              <SortChip label="Manual" active={snapshot.settings.taskSort === 'manual'} onPress={() => setTaskSort('manual')} />
              <SortChip
                label="Created newest"
                active={snapshot.settings.taskSort === 'created-desc'}
                onPress={() => setTaskSort('created-desc')}
              />
              <SortChip
                label="Created oldest"
                active={snapshot.settings.taskSort === 'created-asc'}
                onPress={() => setTaskSort('created-asc')}
              />
              <SortChip
                label="Priority high"
                active={snapshot.settings.taskSort === 'priority-desc'}
                onPress={() => setTaskSort('priority-desc')}
              />
              <SortChip
                label="Priority low"
                active={snapshot.settings.taskSort === 'priority-asc'}
                onPress={() => setTaskSort('priority-asc')}
              />
            </View>

            <View style={styles.sortRow}>
              <SortChip label="All" active={taskFilter === 'all'} onPress={() => setTaskFilter('all')} />
              <SortChip label="Open" active={taskFilter === 'open'} onPress={() => setTaskFilter('open')} />
              <SortChip label="Done" active={taskFilter === 'done'} onPress={() => setTaskFilter('done')} />
            </View>

            <Text style={styles.metaText}>
              Manual reorder enabled: {manualTaskReorderEnabled ? 'Yes (manual mode + no filters)' : 'No'}
            </Text>

            {filteredTasks.map((item) => renderTask(item))}

            {!filteredTasks.length && <Text style={styles.emptyText}>No tasks to show.</Text>}
          </View>
        )}

        {mainView === 'notes' && (
          <View style={styles.sectionWrap}>
            <Text style={styles.sectionTitle}>New Note</Text>
            <TextInput
              value={newNoteText}
              onChangeText={setNewNoteText}
              onSubmitEditing={addNoteItem}
              placeholder="Write a note and press Enter"
              placeholderTextColor="#97A9B8"
              style={styles.input}
            />
            <Pressable style={styles.primaryButton} onPress={addNoteItem}>
              <Text style={styles.primaryButtonText}>Add Note</Text>
            </Pressable>

            <View style={styles.sortRow}>
              <SortChip label="Manual" active={snapshot.settings.noteSort === 'manual'} onPress={() => setNoteSort('manual')} />
              <SortChip
                label="Created newest"
                active={snapshot.settings.noteSort === 'created-desc'}
                onPress={() => setNoteSort('created-desc')}
              />
              <SortChip
                label="Created oldest"
                active={snapshot.settings.noteSort === 'created-asc'}
                onPress={() => setNoteSort('created-asc')}
              />
            </View>

            <Text style={styles.metaText}>
              Manual reorder enabled: {manualNoteReorderEnabled ? 'Yes (manual mode + no filters)' : 'No'}
            </Text>

            {filteredNotes.map((item) => renderNoteCard(item))}

            {!filteredNotes.length && <Text style={styles.emptyText}>No notes to show.</Text>}
          </View>
        )}

        {mainView === 'trash' && (
          <View style={styles.sectionWrap}>
            <Text style={styles.sectionTitle}>Trash</Text>
            {trashItems.map((item) => (
              <View key={item.id} style={styles.trashCard}>
                <Text style={styles.trashType}>{item.type.toUpperCase()}</Text>
                <Text style={styles.trashText}>{item.text}</Text>
                <Text style={styles.metaText}>Deleted at {formatDate(item.deletedAt)}</Text>
                <Pressable style={styles.secondaryButton} onPress={() => restoreFromTrash(item)}>
                  <Text style={styles.secondaryButtonText}>Restore</Text>
                </Pressable>
              </View>
            ))}
            {!trashItems.length && <Text style={styles.emptyText}>Trash is empty.</Text>}
          </View>
        )}
      </ScrollView>

      {undoState && (
        <View style={styles.undoToast}>
          <Text style={styles.undoText}>Item deleted</Text>
          <Pressable onPress={undoDelete}>
            <Text style={styles.undoAction}>Undo</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#EFF4F8',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: '#1B334A',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 4,
    color: '#BED1E3',
    fontSize: 12,
  },
  segmentRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 8,
  },
  sortChip: {
    borderWidth: 1,
    borderColor: '#B6C6D6',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#F8FBFE',
  },
  sortChipActive: {
    borderColor: '#0E5A90',
    backgroundColor: '#D8EFFF',
  },
  sortChipText: {
    fontSize: 12,
    color: '#31506B',
    fontWeight: '600',
  },
  sortChipTextActive: {
    color: '#0E5A90',
  },
  scrollBody: {
    padding: 12,
    gap: 12,
    paddingBottom: 80,
  },
  utilityCard: {
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderWidth: 1,
    borderColor: '#D8E3EC',
    gap: 8,
  },
  sectionWrap: {
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderWidth: 1,
    borderColor: '#D8E3EC',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A3349',
  },
  statusLine: {
    fontSize: 12,
    color: '#4A647B',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#C3D1DE',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: '#152A3C',
    backgroundColor: '#F9FCFF',
  },
  primaryButton: {
    borderRadius: 10,
    backgroundColor: '#0E5A90',
    alignItems: 'center',
    paddingVertical: 10,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#8AB3D6',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
    backgroundColor: '#E9F4FF',
  },
  secondaryButtonText: {
    color: '#155B8C',
    fontWeight: '700',
  },
  rowGap10: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  sortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  itemCard: {
    borderWidth: 1,
    borderColor: '#D7E4EE',
    borderRadius: 12,
    backgroundColor: '#FDFEFF',
    padding: 10,
    gap: 8,
    marginBottom: 10,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: '#6A8AA7',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#1E8A5A',
    borderColor: '#1E8A5A',
  },
  checkboxText: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  dragHandle: {
    borderWidth: 1,
    borderColor: '#B9CBDA',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dragHandleText: {
    color: '#40617E',
    fontWeight: '900',
  },
  dragDisabled: {
    color: '#9FB2C2',
  },
  priorityWrap: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  priorityLabel: {
    fontWeight: '800',
    color: '#264863',
  },
  priorityButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  priorityBtn: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0E5A90',
  },
  itemTextInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#CEDCE8',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#1A334A',
    backgroundColor: '#FFFFFF',
  },
  tagsRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  tagChip: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: '#DCEBFA',
  },
  tagText: {
    color: '#1B5680',
    fontWeight: '700',
    fontSize: 12,
  },
  tagChipAdd: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: '#E9F8EF',
  },
  tagTextAdd: {
    color: '#237048',
    fontWeight: '700',
    fontSize: 12,
  },
  globalTagWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E8F1FA',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  globalTagText: {
    color: '#275574',
    fontWeight: '700',
    fontSize: 12,
  },
  globalTagTextActive: {
    color: '#0E5A90',
  },
  removeTagText: {
    color: '#8A3B3B',
    fontSize: 14,
    fontWeight: '900',
  },
  metaText: {
    color: '#587086',
    fontSize: 11,
  },
  deleteButton: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    backgroundColor: '#FCE6E6',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  deleteButtonText: {
    color: '#8D2C2C',
    fontWeight: '700',
  },
  prioritySummaryWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  prioritySummaryText: {
    fontSize: 12,
    color: '#335977',
    fontWeight: '600',
  },
  emptyText: {
    color: '#658097',
    fontStyle: 'italic',
  },
  trashCard: {
    borderWidth: 1,
    borderColor: '#DFE6ED',
    borderRadius: 10,
    backgroundColor: '#FAFCFE',
    padding: 10,
    gap: 6,
    marginBottom: 10,
  },
  trashType: {
    color: '#24506F',
    fontWeight: '800',
    fontSize: 11,
  },
  trashText: {
    color: '#213A4E',
    fontSize: 14,
  },
  undoToast: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 14,
    backgroundColor: '#183043',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  undoText: {
    color: '#E8F1F8',
    fontWeight: '600',
  },
  undoAction: {
    color: '#93D5FF',
    fontWeight: '800',
  },
});
