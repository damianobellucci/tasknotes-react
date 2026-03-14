import { buildDefaultSnapshot, createTask, loadSnapshot, saveSnapshot } from '../src/tasknotes';

const storage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(async (key: string, value: string) => {
    storage.set(key, value);
  }),
  getItem: jest.fn(async (key: string) => storage.get(key) ?? null),
  removeItem: jest.fn(async (key: string) => {
    storage.delete(key);
  }),
  clear: jest.fn(async () => {
    storage.clear();
  }),
}));

describe('Storage/Sync', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('saves and loads snapshot', async () => {
    const snap = buildDefaultSnapshot();
    snap.tasks.push(createTask('Test task', 0));
    await saveSnapshot(snap);
    const loaded = await loadSnapshot();
    expect(loaded.tasks.length).toBe(1);
    expect(loaded.tasks[0].text).toBe('Test task');
  });

  it('overwrites snapshot', async () => {
    const snap = buildDefaultSnapshot();
    snap.tasks.push(createTask('Overwrite task', 0));
    await saveSnapshot(snap);
    const loaded = await loadSnapshot();
    expect(loaded.tasks[0].text).toBe('Overwrite task');
  });
});
