# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [1.0.6] - 2026-03-15

### Added
- Header quick actions for account, global tools, and sync status pages.
- Full-screen task composer flow with explicit Save action, draft tag management, and task edit mode.
- Task tag filter chips in the task filtering area, including `All tags` and per-tag chips.
- Android APK end-to-end smoke testing with Maestro (`.maestro/flows/smoke-dev.yaml`) and npm scripts for local/CI execution.

### Changed
- Task creation now uses a floating action button and dedicated compose screen instead of inline task input.
- Manual sort behavior now inserts newly created tasks at the top when manual mode is active.
- Development login defaults can be provided locally through `.env.local` (`EXPO_PUBLIC_DEV_LOGIN_EMAIL`, `EXPO_PUBLIC_DEV_LOGIN_PASSWORD`) in dev mode only.

### Fixed
- Global tag deletion from settings now reliably removes the tag from the global catalog and from all tasks/notes.
- Settings tag delete confirmation now works consistently on web and native platforms.

## [1.0.5] - 2026-03-14

### Fixed
- Release APK now falls back to default Cognito region/client id when `EXPO_PUBLIC_COGNITO_REGION` and `EXPO_PUBLIC_COGNITO_CLIENT_ID` are not injected at build time.
- Login screen no longer starts with immediate "Cognito missing config" in release builds for the known production Cognito setup.

## [1.0.4] - 2026-03-14

### Fixed
- GitHub Release workflow now generates the Android project in CI before Gradle execution.
- Release pipeline now writes `android/local.properties` only after resolving a valid Android SDK path.

### Changed
- Android APK upload process in GitHub Releases is now resilient for Expo-managed repositories where `android/` is not tracked.

## [1.0.3] - 2026-03-14

### Added
- Android APK build and upload as a GitHub Release asset for semantic tags.

## [1.0.2] - 2026-03-14

### Fixed
- Release workflow shell syntax corrected for tag/version validation.

## [1.0.1] - 2026-03-14

### Added
- GitHub Actions CI workflow for lint and test on push/PR.
- GitHub Actions release workflow triggered by semantic version tags (`v*.*.*`).
- EAS build configuration (`eas.json`) and npm scripts for build/submit and release bumps.

### Changed
- Application metadata prepared for store publication:
	- app name set to `TaskNotes`
	- Android package set to `com.damianobellucci.tasknotes`
	- iOS bundle identifier set to `com.damianobellucci.tasknotes`
- README extended with release, tagging, and distribution documentation.

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
