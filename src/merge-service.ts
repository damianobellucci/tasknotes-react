import { AnyItem, AppSnapshot } from './tasknotes';

export type MergeResult = {
  merged: AppSnapshot;
  conflicts: AnyItem[];
};

export function mergeSnapshots(base: AppSnapshot | null, local: AppSnapshot, remote: AppSnapshot): MergeResult {
  // Simple three-way merge: base, local, remote
  // Only tasks/notes/tags/settings, not sync metadata
  const merged: AppSnapshot = {
    ...local,
    tasks: [],
    notes: [],
    tags: [],
    settings: { ...local.settings },
    sync: { ...local.sync },
    version: 1,
  };
  const conflicts: AnyItem[] = [];

  // Merge tasks
  const allTaskIds = Array.from(new Set([
    ...local.tasks.map(t => t.id),
    ...remote.tasks.map(t => t.id),
    ...(base?.tasks.map(t => t.id) ?? []),
  ]));
  for (const id of allTaskIds) {
    const baseTask = base?.tasks.find(t => t.id === id);
    const localTask = local.tasks.find(t => t.id === id);
    const remoteTask = remote.tasks.find(t => t.id === id);
    if (!localTask && remoteTask) {
      merged.tasks.push(remoteTask);
      continue;
    }
    if (localTask && !remoteTask) {
      merged.tasks.push(localTask);
      continue;
    }
    if (localTask && remoteTask) {
      // Both changed
      if (JSON.stringify(localTask) === JSON.stringify(remoteTask)) {
        merged.tasks.push(localTask);
        continue;
      }
      if (baseTask && JSON.stringify(localTask) !== JSON.stringify(baseTask) && JSON.stringify(remoteTask) !== JSON.stringify(baseTask)) {
        // Conflict: both changed
        conflicts.push(localTask);
        merged.tasks.push({ ...localTask, text: '[Conflict copy] ' + localTask.text });
        continue;
      }
      // Prefer local if only local changed
      merged.tasks.push(localTask);
    }
  }

  // Merge notes
  const allNoteIds = Array.from(new Set([
    ...local.notes.map(n => n.id),
    ...remote.notes.map(n => n.id),
    ...(base?.notes.map(n => n.id) ?? []),
  ]));
  for (const id of allNoteIds) {
    const baseNote = base?.notes.find(n => n.id === id);
    const localNote = local.notes.find(n => n.id === id);
    const remoteNote = remote.notes.find(n => n.id === id);
    if (!localNote && remoteNote) {
      merged.notes.push(remoteNote);
      continue;
    }
    if (localNote && !remoteNote) {
      merged.notes.push(localNote);
      continue;
    }
    if (localNote && remoteNote) {
      if (JSON.stringify(localNote) === JSON.stringify(remoteNote)) {
        merged.notes.push(localNote);
        continue;
      }
      if (baseNote && JSON.stringify(localNote) !== JSON.stringify(baseNote) && JSON.stringify(remoteNote) !== JSON.stringify(baseNote)) {
        conflicts.push(localNote);
        merged.notes.push({ ...localNote, text: '[Conflict copy] ' + localNote.text });
        continue;
      }
      merged.notes.push(localNote);
    }
  }

  // Merge tags
  merged.tags = Array.from(new Set([
    ...local.tags.map(t => t.toLowerCase()),
    ...remote.tags.map(t => t.toLowerCase()),
    ...(base?.tags.map(t => t.toLowerCase()) ?? []),
  ]));

  // Merge settings
  merged.settings = { ...remote.settings, ...local.settings };

  // Resequence manual order
  merged.tasks = merged.tasks.map((t, idx) => ({ ...t, manualOrder: idx }));
  merged.notes = merged.notes.map((n, idx) => ({ ...n, manualOrder: idx }));

  return { merged, conflicts };
}
