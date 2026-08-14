# Android Setup

## Requirements

- Android 8.0+ (API 26)
- Active SIM with SMS capability
- Network access to Gateway Server (HTTPS)

## Build

1. Open `android/` in Android Studio
2. Sync Gradle
3. Select flavor:
   - **dev** — FakeSmsSender (no real SMS, for development)
   - **prod** — Real SMS via device SIM

```bash
./gradlew assembleProdRelease
```

## Install

Install the APK on your gateway phone. For production, sign with your own keystore.

## First-Time Setup

1. On the server, create a registration token:
   ```bash
   cd server && npm run create-registration-token
   ```

2. In the app:
   - **Gateway Server URL:** `https://your-server.example.com` (trailing slash optional)
   - **Registration Token:** token from step 1
   - **Gateway Name:** e.g. "Office SIM 1"
   - **SIM Subscription:** select on dual-SIM devices

3. Grant permissions when prompted

4. Verify dashboard shows "Running" status

## Permissions

| Permission | Purpose |
|------------|---------|
| INTERNET | Connect to Gateway Server |
| ACCESS_NETWORK_STATE | Detect connectivity |
| SEND_SMS | Send messages via SIM |
| READ_PHONE_STATE | SIM detection, dual-SIM selection |
| RECEIVE_BOOT_COMPLETED | Restart service after reboot |
| FOREGROUND_SERVICE | Keep gateway running in background |
| POST_NOTIFICATIONS | Show persistent service notification |

## Battery Optimization

Android may kill background services. For reliable operation:

1. Settings → Apps → SMS Gateway → Battery → Unrestricted
2. Disable battery optimization for the app
3. Keep the foreground notification visible

## Dual-SIM

During setup or in settings, select the subscription to use. The app uses `SmsManager.getSmsManagerForSubscriptionId()` when a subscription is selected.

## Test SMS

Dashboard → **Send Test SMS** sends a local SMS (not through the server queue). Requires explicit confirmation.

## Pause / Resume

Settings → Pause Gateway stops polling and job processing. Resume restarts the foreground service.

## Re-register

Settings → Re-register clears current setup and starts registration again. Requires a new registration token from the server.

## Troubleshooting

| Symptom | Solution |
|---------|----------|
| "No SIM detected" | Insert SIM, restart app, grant READ_PHONE_STATE |
| "Airplane mode is on" | Disable airplane mode |
| Service stops | Exempt from battery optimization |
| 401 on heartbeat | Re-register; credentials may be revoked |
| SMS permission denied | Grant in system settings |

## Diagnostics

Dashboard → View Diagnostics shows redacted log entries (no message bodies or secrets).
