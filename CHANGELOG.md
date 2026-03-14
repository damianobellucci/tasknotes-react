# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [1.0.0] - 2026-03-14

### Added
- React Native TaskNotes app with tasks, notes, tags, and local persistence.
- Cognito authentication flow aligned with desktop behavior.
- Automatic cloud sync (pull/push), conflict merge, retry handling, and status feedback.
- Android crypto polyfill for Cognito SDK compatibility.
- Test suite for merge logic, storage sync behavior, and tag utilities.

### Changed
- Cloud status messages aligned with desktop application wording.
- Sync baseline logic updated to avoid redundant sync loops.
