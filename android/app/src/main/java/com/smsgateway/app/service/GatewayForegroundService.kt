// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.smsgateway.app.BuildConfig
import com.smsgateway.app.MainActivity
import com.smsgateway.app.R
import com.smsgateway.app.data.api.HeartbeatRequest
import com.smsgateway.app.data.local.CredentialStore
import com.smsgateway.app.device.NetworkMonitor
import com.smsgateway.app.device.SimManager
import com.smsgateway.app.domain.JobProcessor
import com.smsgateway.app.util.DiagnosticLog
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import kotlin.math.min

@AndroidEntryPoint
class GatewayForegroundService : Service() {

    @Inject lateinit var credentialStore: CredentialStore
    @Inject lateinit var apiProvider: @JvmSuppressWildcards () -> com.smsgateway.app.data.api.GatewayApi
    @Inject lateinit var jobProcessor: JobProcessor
    @Inject lateinit var simManager: SimManager
    @Inject lateinit var networkMonitor: NetworkMonitor

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollJob: Job? = null
    private var backoffMs = POLL_INTERVAL_MS

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("Starting…"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
        }
        startPolling()
        return START_STICKY
    }

    override fun onDestroy() {
        pollJob?.cancel()
        serviceScope.cancel()
        super.onDestroy()
    }

    private fun startPolling() {
        if (pollJob?.isActive == true) return
        pollJob = serviceScope.launch {
            jobProcessor.replayUnreportedResults()
            while (isActive) {
                try {
                    if (!credentialStore.isRegistered()) {
                        updateNotification("Not registered")
                        delay(POLL_INTERVAL_MS)
                        continue
                    }
                    if (credentialStore.isPaused) {
                        updateNotification("Paused")
                        delay(POLL_INTERVAL_MS)
                        continue
                    }
                    if (!networkMonitor.isNetworkAvailable()) {
                        updateNotification("No network")
                        backoffMs = min(backoffMs * 2, MAX_BACKOFF_MS)
                        delay(backoffMs)
                        continue
                    }

                    val creds = credentialStore.get()!!
                    val simStatus = simManager.getSimStatus()
                    val subId = creds.subscriptionId ?: credentialStore.selectedSubscriptionId

                    apiProvider().heartbeat(
                        "Gateway ${creds.gatewayId}:${creds.secret}",
                        HeartbeatRequest(
                            appVersion = BuildConfig.VERSION_NAME,
                            simInfo = simStatus.description,
                            networkInfo = networkMonitor.getNetworkDescription(),
                            paused = credentialStore.isPaused,
                        ),
                    )
                    jobProcessor.updateHeartbeat()

                    val jobs = apiProvider().getJobs("Gateway ${creds.gatewayId}:${creds.secret}")
                    updateNotification("Active — ${jobs.jobs.size} job(s)")

                    for (job in jobs.jobs) {
                        jobProcessor.processJob(job, subId)
                    }

                    backoffMs = POLL_INTERVAL_MS
                } catch (e: Exception) {
                    DiagnosticLog.log("Poll error: ${e.message}")
                    backoffMs = min(backoffMs * 2, MAX_BACKOFF_MS)
                }
                delay(backoffMs)
            }
        }
    }

    private fun buildNotification(text: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        private const val CHANNEL_ID = "gateway_service"
        private const val NOTIFICATION_ID = 1001
        private const val POLL_INTERVAL_MS = 15_000L
        private const val MAX_BACKOFF_MS = 300_000L
        const val ACTION_STOP = "com.smsgateway.app.STOP_SERVICE"

        fun start(context: Context) {
            val intent = Intent(context, GatewayForegroundService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, GatewayForegroundService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }
}
