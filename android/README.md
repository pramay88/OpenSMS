# Android Gateway

Native Kotlin + Jetpack Compose app that sends SMS via the device SIM.

## Build

Open in Android Studio (recommended) or:

```bash
./gradlew assembleDevDebug    # FakeSmsSender, no real SMS
./gradlew assembleProdRelease # Production SMS
```

## Flavors

| Flavor | SMS | Use |
|--------|-----|-----|
| dev | FakeSmsSender | Development and testing |
| prod | AndroidSmsSender | Production gateways |

See [docs/ANDROID-SETUP.md](../docs/ANDROID-SETUP.md) for setup instructions.
