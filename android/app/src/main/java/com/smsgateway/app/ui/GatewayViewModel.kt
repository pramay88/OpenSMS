// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smsgateway.app.BuildConfig
import com.smsgateway.app.data.local.CredentialStore
import com.smsgateway.app.device.NetworkMonitor
import com.smsgateway.app.device.SimManager
import com.smsgateway.app.domain.GatewayRepository
import com.smsgateway.app.domain.JobProcessor
import com.smsgateway.app.service.GatewayForegroundService
import com.smsgateway.app.sms.SmsSender
import com.smsgateway.app.util.DiagnosticLog
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class GatewayUiState(
    val isRegistered: Boolean = false,
    val gatewayId: String? = null,
    val gatewayName: String? = null,
    val serverUrl: String? = null,
    val isPaused: Boolean = false,
    val isServiceRunning: Boolean = false,
    val simDescription: String = "Unknown",
    val networkDescription: String = "Unknown",
    val sentCount: Int = 0,
    val failedCount: Int = 0,
    val currentJobId: String? = null,
    val lastError: String? = null,
    val lastHeartbeat: String? = null,
    val appVersion: String = BuildConfig.VERSION_NAME,
    val connectionTestResult: String? = null,
    val testSmsResult: String? = null,
    val registrationSuccess: Boolean = false,
    val registrationError: String? = null,
    val availableSims: List<com.smsgateway.app.device.SimInfo> = emptyList(),
    val hasSmsPermission: Boolean = false,
    val hasPhoneStatePermission: Boolean = false,
)

@HiltViewModel
class GatewayViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialStore: CredentialStore,
    private val gatewayRepository: GatewayRepository,
    private val jobProcessor: JobProcessor,
    private val simManager: SimManager,
    private val networkMonitor: NetworkMonitor,
    private val smsSender: SmsSender,
) : ViewModel() {

    private val _uiState = MutableStateFlow(GatewayUiState())
    val uiState: StateFlow<GatewayUiState> = _uiState.asStateFlow()

    init {
        refresh()
        viewModelScope.launch {
            jobProcessor.stats.collect { stats ->
                _uiState.update {
                    it.copy(
                        sentCount = stats.sentCount,
                        failedCount = stats.failedCount,
                        lastError = stats.lastError,
                        currentJobId = stats.currentJobId,
                        lastHeartbeat = stats.lastHeartbeat,
                    )
                }
            }
        }
    }

    fun refresh() {
        val creds = credentialStore.get()
        val sim = simManager.getSimStatus()

        val smsPermission = ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
        val phonePermission = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED

        _uiState.update {
            it.copy(
                isRegistered = creds != null,
                gatewayId = creds?.gatewayId,
                gatewayName = creds?.gatewayName,
                serverUrl = creds?.serverUrl,
                isPaused = credentialStore.isPaused,
                simDescription = sim.description,
                networkDescription = networkMonitor.getNetworkDescription(),
                availableSims = sim.sims,
                hasSmsPermission = smsPermission,
                hasPhoneStatePermission = phonePermission,
            )
        }
        if (creds != null && !credentialStore.isPaused) {
            GatewayForegroundService.start(context)
            _uiState.update { it.copy(isServiceRunning = true) }
        }
    }

    fun register(serverUrl: String, token: String, name: String, subscriptionId: Int?, onComplete: (Boolean, String?) -> Unit = { _, _ -> }) {
        viewModelScope.launch {
            try {
                if (subscriptionId != null) {
                    credentialStore.selectedSubscriptionId = subscriptionId
                }
                gatewayRepository.register(serverUrl, token, name)
                credentialStore.isPaused = false
                GatewayForegroundService.start(context)
                refresh()
                _uiState.update { it.copy(registrationSuccess = true, registrationError = null) }
                onComplete(true, null)
            } catch (e: Exception) {
                DiagnosticLog.log("Registration failed: ${e.message}")
                _uiState.update { it.copy(registrationError = e.message, registrationSuccess = false) }
                onComplete(false, e.message)
            }
        }
    }

    fun togglePause() {
        credentialStore.isPaused = !credentialStore.isPaused
        if (credentialStore.isPaused) {
            GatewayForegroundService.stop(context)
            _uiState.update { it.copy(isPaused = true, isServiceRunning = false) }
        } else {
            GatewayForegroundService.start(context)
            _uiState.update { it.copy(isPaused = false, isServiceRunning = true) }
        }
    }

    fun testConnection() {
        viewModelScope.launch {
            val result = gatewayRepository.testConnection()
            _uiState.update {
                it.copy(
                    connectionTestResult = if (result.isSuccess) "Connection OK" else "Failed: ${result.exceptionOrNull()?.message}",
                )
            }
        }
    }

    fun sendTestSms(to: String, message: String) {
        viewModelScope.launch {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                _uiState.update { it.copy(testSmsResult = "SMS permission required") }
                return@launch
            }
            val subId = credentialStore.selectedSubscriptionId
            val result = smsSender.send(to, message, subId)
            _uiState.update {
                it.copy(
                    testSmsResult = if (result.isSuccess) "Test SMS sent" else "Failed: ${result.exceptionOrNull()?.message}",
                )
            }
        }
    }

    fun clearCredentials() {
        credentialStore.clear()
        GatewayForegroundService.stop(context)
        _uiState.value = GatewayUiState(appVersion = BuildConfig.VERSION_NAME)
    }
}
