# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

3. Configure environment variables

   Copy `.env.example` to `.env` and fill your values:

   ```bash
   cp .env.example .env
   ```

   Required for Cognito login:

   - `EXPO_PUBLIC_COGNITO_REGION`
   - `EXPO_PUBLIC_COGNITO_CLIENT_ID`

   Optional:

   - `EXPO_PUBLIC_TASKNOTES_SYNC_URL`
   - `EXPO_PUBLIC_TASKNOTES_SYNC_API_KEY`

   After changing `.env`, restart Expo.

## Release and versioning

This repository is configured for Semantic Versioning with Git tags and GitHub Releases.

### CI and release workflows

- `.github/workflows/ci.yml`: runs lint and tests on every push to `main` and every pull request.
- `.github/workflows/release.yml`: runs on tags like `v1.2.3`, verifies that tag version matches `package.json`, runs lint/tests, then creates a GitHub Release automatically.

### Create a new release

1. Choose the bump type:

    ```bash
    npm run release:patch
    # or
    npm run release:minor
    # or
    npm run release:major
    ```

2. Push commit and tag:

    ```bash
    git push origin main --follow-tags
    ```

3. GitHub Actions will publish the Release for the pushed `v*.*.*` tag.

### Mobile build distribution

- Production Android build:

   ```bash
   npm run build:android
   ```

- Production iOS build:

   ```bash
   npm run build:ios
   ```

- Submit Android/iOS binaries through EAS Submit:

   ```bash
   npm run submit:android
   npm run submit:ios
   ```

## Android APK E2E tests (Maestro)

Use Maestro to run user-like end-to-end flows against the Android app.

1. Install Maestro CLI (one-time):

   ```bash
   curl -Ls "https://get.maestro.mobile.dev" | bash
   ```

2. Build/install the Android app on emulator or device:

   ```bash
   npm run android
   ```

3. Run the smoke E2E flow:

   ```bash
   npm run test:e2e:apk
   ```

Flow file:

- `.maestro/flows/smoke-dev.yaml`

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
