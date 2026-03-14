import AsyncStorage from '@react-native-async-storage/async-storage';

export type ItemType = 'task' | 'note';

export type TaskSortMode = 'manual' | 'created-desc' | 'created-asc' | 'priority-desc' | 'priority-asc';
export type NoteSortMode = 'manual' | 'created-desc' | 'created-asc';
export type TaskFilter = 'all' | 'open' | 'done';

export type BaseItem = {
  id: string;
  type: ItemType;
  text: string;
  createdAt: string;
  updatedAt: string;
  editCount: number;
  manualOrder: number;
  tags: string[];
  isDeleted: boolean;
  deletedAt: string | null;
};

export type Task = BaseItem & {
  type: 'task';
  done: boolean;
  priority: number;
  archived: boolean;
};

export type Note = BaseItem & {
  type: 'note';
};

export type AnyItem = Task | Note;

export type AppSnapshot = {
  version: 1;
  tasks: Task[];
  notes: Note[];
  tags: string[];
  settings: {
    taskSort: TaskSortMode;
    noteSort: NoteSortMode;
  };
  sync: {
    serverUpdatedAt: string;
    lastSyncedSnapshot: AppSnapshot | null;
  };
};

const STORAGE_KEY = '@tasknotes/snapshot/v1';
const AUTH_STORAGE_KEY = '@tasknotes/auth-session/v1';

export type AuthSession = {
  email: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};

export function buildDefaultSnapshot(): AppSnapshot {
  return {
    version: 1,
    tasks: [],
    notes: [],
    tags: [],
    settings: {
      taskSort: 'manual',
      noteSort: 'manual',
    },
    sync: {
      serverUpdatedAt: '',
      lastSyncedSnapshot: null,
    },
  };
}

export function cloneSnapshot(snapshot: AppSnapshot): AppSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as AppSnapshot;
}

export function createSyncBaseline(snapshot: AppSnapshot): AppSnapshot {
  const cloned = cloneSnapshot(snapshot);
  cloned.sync.serverUpdatedAt = '';
  cloned.sync.lastSyncedSnapshot = null;
  return cloned;
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: ItemType): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`;
}

export function normalizeTag(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 32);
}

export function addTag(tags: string[], tag: string): string[] {
  const normalized = normalizeTag(tag);
  if (!normalized) {
    return tags;
  }
  if (tags.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) {
    return tags;
  }
  return [...tags, normalized];
}

export function removeTag(tags: string[], tag: string): string[] {
  return tags.filter((entry) => entry.toLowerCase() !== tag.toLowerCase());
}

function normalizeText(input: unknown): string {
  if (typeof input !== 'string') {
    return '';
  }
  return input.trim();
}

function clampPriority(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 5;
  }
  return Math.max(1, Math.min(10, Math.round(value)));
}

function normalizeIso(value: unknown): string {
  if (typeof value !== 'string') {
    return nowIso();
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.valueOf())) {
    return nowIso();
  }
  return dt.toISOString();
}

function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  const output: string[] = [];
  tags.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const normalized = normalizeTag(value);
    if (!normalized) {
      return;
    }
    if (!output.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
      output.push(normalized);
    }
  });
  return output;
}

function sanitizeManualOrder(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function sanitizeTask(value: unknown, fallbackOrder: number): Task {
  const raw = (value ?? {}) as Partial<Task>;
  const createdAt = normalizeIso(raw.createdAt);
  const updatedAt = normalizeIso(raw.updatedAt ?? raw.createdAt);
  return {
    id: typeof raw.id === 'string' && raw.id.trim().length ? raw.id : randomId('task'),
    type: 'task',
    text: normalizeText(raw.text),
    done: !!raw.done,
    priority: clampPriority(raw.priority),
    createdAt,
    updatedAt,
    editCount: typeof raw.editCount === 'number' && raw.editCount >= 0 ? Math.floor(raw.editCount) : 0,
    manualOrder: sanitizeManualOrder(raw.manualOrder, fallbackOrder),
    archived: !!raw.archived,
    tags: sanitizeTags(raw.tags),
    isDeleted: !!raw.isDeleted,
    deletedAt: raw.deletedAt ? normalizeIso(raw.deletedAt) : null,
  };
}

function sanitizeNote(value: unknown, fallbackOrder: number): Note {
  const raw = (value ?? {}) as Partial<Note>;
  const createdAt = normalizeIso(raw.createdAt);
  const updatedAt = normalizeIso(raw.updatedAt ?? raw.createdAt);
  return {
    id: typeof raw.id === 'string' && raw.id.trim().length ? raw.id : randomId('note'),
    type: 'note',
    text: normalizeText(raw.text),
    createdAt,
    updatedAt,
    editCount: typeof raw.editCount === 'number' && raw.editCount >= 0 ? Math.floor(raw.editCount) : 0,
    manualOrder: sanitizeManualOrder(raw.manualOrder, fallbackOrder),
    tags: sanitizeTags(raw.tags),
    isDeleted: !!raw.isDeleted,
    deletedAt: raw.deletedAt ? normalizeIso(raw.deletedAt) : null,
  };
}

export function withResequencedManualOrder<T extends AnyItem>(items: T[]): T[] {
  return [...items]
    .sort((a, b) => a.manualOrder - b.manualOrder)
    .map((item, index) => ({ ...item, manualOrder: index }));
}

export function sanitizeSnapshot(value: unknown): AppSnapshot {
  const raw = (value ?? {}) as Partial<AppSnapshot>;
  const defaults = buildDefaultSnapshot();

  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map((item, idx) => sanitizeTask(item, idx)) : [];
  const notes = Array.isArray(raw.notes) ? raw.notes.map((item, idx) => sanitizeNote(item, idx)) : [];

  return {
    version: 1,
    tasks: withResequencedManualOrder(tasks),
    notes: withResequencedManualOrder(notes),
    tags: sanitizeTags(raw.tags),
    settings: {
      taskSort: raw.settings?.taskSort ?? defaults.settings.taskSort,
      noteSort: raw.settings?.noteSort ?? defaults.settings.noteSort,
    },
    sync: {
      serverUpdatedAt: typeof raw.sync?.serverUpdatedAt === 'string' ? raw.sync.serverUpdatedAt : '',
      lastSyncedSnapshot: raw.sync?.lastSyncedSnapshot ? sanitizeSnapshot(raw.sync.lastSyncedSnapshot) : null,
    },
  };
}

export function createTask(text: string, fallbackOrder: number): Task {
  const now = nowIso();
  return {
    id: randomId('task'),
    type: 'task',
    text: normalizeText(text),
    done: false,
    priority: 5,
    createdAt: now,
    updatedAt: now,
    editCount: 0,
    manualOrder: fallbackOrder,
    archived: false,
    tags: [],
    isDeleted: false,
    deletedAt: null,
  };
}

export function createNote(text: string, fallbackOrder: number): Note {
  const now = nowIso();
  return {
    id: randomId('note'),
    type: 'note',
    text: normalizeText(text),
    createdAt: now,
    updatedAt: now,
    editCount: 0,
    manualOrder: fallbackOrder,
    tags: [],
    isDeleted: false,
    deletedAt: null,
  };
}

export function sortItems<T extends AnyItem>(items: T[], mode: TaskSortMode | NoteSortMode): T[] {
  const sorted = [...items];
  if (mode === 'manual') {
    return sorted.sort((a, b) => a.manualOrder - b.manualOrder);
  }
  if (mode === 'created-desc') {
    return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  if (mode === 'created-asc') {
    return sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  if (mode === 'priority-desc') {
    return sorted.sort((a, b) => {
      const pA = a.type === 'task' ? a.priority : 0;
      const pB = b.type === 'task' ? b.priority : 0;
      return pB - pA;
    });
  }
  if (mode === 'priority-asc') {
    return sorted.sort((a, b) => {
      const pA = a.type === 'task' ? a.priority : 0;
      const pB = b.type === 'task' ? b.priority : 0;
      return pA - pB;
    });
  }
  return sorted;
}

export async function saveSnapshot(snapshot: AppSnapshot): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export async function loadSnapshot(): Promise<AppSnapshot> {
  const payload = await AsyncStorage.getItem(STORAGE_KEY);
  if (!payload) {
    return buildDefaultSnapshot();
  }
  try {
    const parsed = JSON.parse(payload) as unknown;
    return sanitizeSnapshot(parsed);
  } catch {
    return buildDefaultSnapshot();
  }
}

export function hasUnsyncedChanges(snapshot: AppSnapshot): boolean {
  if (!snapshot.sync.lastSyncedSnapshot) {
    return snapshot.tasks.length > 0 || snapshot.notes.length > 0 || snapshot.tags.length > 0;
  }
  const currentBaseline = createSyncBaseline(snapshot);
  const syncedBaseline = createSyncBaseline(snapshot.sync.lastSyncedSnapshot);
  return JSON.stringify(syncedBaseline) !== JSON.stringify(currentBaseline);
}

export function getCloudConfig(): {
  syncUrl: string;
  apiKey: string;
} {
  return {
    syncUrl: process.env.EXPO_PUBLIC_TASKNOTES_SYNC_URL ?? '',
    apiKey: process.env.EXPO_PUBLIC_TASKNOTES_SYNC_API_KEY ?? '',
  };
}

export async function loadAuthSession(): Promise<AuthSession | null> {
  const payload = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
  if (!payload) {
    return null;
  }
  try {
    const parsed = JSON.parse(payload) as Partial<AuthSession>;
    if (!parsed.email || !parsed.accessToken) {
      return null;
    }
    return {
      email: parsed.email,
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : '',
      expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0,
    };
  } catch {
    return null;
  }
}

export async function saveAuthSession(session: AuthSession): Promise<void> {
  await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export async function clearAuthSession(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
}
