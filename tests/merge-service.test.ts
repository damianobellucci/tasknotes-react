import { mergeSnapshots } from '../src/merge-service';
import { buildDefaultSnapshot, createTask } from '../src/tasknotes';

describe('MergeService', () => {
  it('merges non-conflicting tasks', () => {
    const base = buildDefaultSnapshot();
    const local = buildDefaultSnapshot();
    const remote = buildDefaultSnapshot();
    local.tasks.push(createTask('local', 0));
    remote.tasks.push(createTask('remote', 0));
    const { merged, conflicts } = mergeSnapshots(base, local, remote);
    expect(merged.tasks.length).toBe(2);
    expect(conflicts.length).toBe(0);
  });

  it('detects conflict and creates conflict copy', () => {
    const base = buildDefaultSnapshot();
    const local = buildDefaultSnapshot();
    const remote = buildDefaultSnapshot();
    const task = createTask('base', 0);
    base.tasks.push(task);
    local.tasks.push({ ...task, text: 'local changed' });
    remote.tasks.push({ ...task, text: 'remote changed' });
    const { merged, conflicts } = mergeSnapshots(base, local, remote);
    expect(merged.tasks.some(t => t.text.startsWith('[Conflict copy]'))).toBe(true);
    expect(conflicts.length).toBe(1);
  });
});
