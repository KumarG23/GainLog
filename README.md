# GainLog

A mobile fitness and nutrition companion built to make everyday health data more useful rather than simply collecting more of it.

GainLog brings workout tracking, nutrition, goals, trends, recovery context, reminders, and Android Health Connect data into one application. It started as a personal tool and has grown into a larger experiment in building a useful, data-driven mobile product with an AI-assisted development workflow.

## What it does

- Tracks workouts, workout history, templates, and personal records
- Surfaces trends and recovery-oriented insights from logged activity
- Tracks nutrition and remembers useful nutrition context
- Supports goals and progress views
- Schedules meal and activity reminders
- Integrates with Android Health Connect for supported health and activity data
- Supports background/incremental synchronization workflows
- Includes automated tests across health sync, nutrition, workouts, goals, trends, notifications, and UI behavior

## Stack

- **React Native 0.81 + React 19**
- **Expo SDK 54 + Expo Router**
- **TypeScript**
- **Android Health Connect** via `react-native-health-connect`
- **AsyncStorage** for local application state
- Expo background tasks and notifications
- Node's built-in test runner for application-level tests

## Why I built it

I wanted a fitness application that reflected how I actually train and make decisions: recent performance, workout history, nutrition, recovery context, and goals should work together instead of living in separate apps.

That made GainLog a useful product-engineering project as well as a personal tool. The interesting work is less about rendering screens and more about deciding how health data should synchronize, how history should be interpreted, what belongs on-device, how reminders should behave, and how to keep the UI useful as the feature set grows.

## Engineering highlights

### Health-data synchronization

GainLog includes Health Connect synchronization and supporting tests for normal sync, change sync, automatic/background sync, nutrition sync, repair flows, and UI state around health-data connectivity.

### Workout and trend logic

The app includes dedicated logic and tests for workout templates, history hints, records, recovery-oriented insights, cardio modality handling, trends, and weekly recovery presentation.

### Testable product behavior

The repository includes focused test suites rather than relying only on manual UI testing. Current test commands cover notifications, nutrition memory, visual/UI behavior, workout workflows, trends, goals, Health Connect, and API configuration.

```bash
npm test
```

## Development approach

This is a modern **AI-assisted engineering** project. I define the product direction, requirements, data behavior, architecture, validation criteria, and what the application should actually accomplish. Tools such as Codex and Claude accelerate implementation, debugging, testing, and refactoring.

I intentionally keep that distinction visible: AI increases implementation speed, but product decisions, validation, and responsibility for the resulting system remain human-owned.

## Running locally

```bash
npm install
npx expo start
```

For native Health Connect functionality, use an Android development build rather than Expo Go.

```bash
npm run android
```

## Status

GainLog is an actively evolving personal project. It is not a medical device and is not intended to provide medical diagnosis or treatment advice.
