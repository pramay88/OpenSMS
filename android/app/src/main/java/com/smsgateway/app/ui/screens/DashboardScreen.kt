// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.smsgateway.app.ui.GatewayUiState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    uiState: GatewayUiState,
    onNavigateSettings: () -> Unit,
    onNavigateDiagnostics: () -> Unit,
    onNavigateTestSms: () -> Unit,
    onRefresh: () -> Unit,
) {
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { onRefresh() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("SMS Gateway") },
                actions = {
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                    IconButton(onClick = onNavigateSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (!uiState.hasSmsPermission || !uiState.hasPhoneStatePermission) {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    ),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            "Permissions Required",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onErrorContainer
                        )
                        Text(
                            "SMS and Phone permissions are revoked. The gateway cannot send messages.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Button(
                            onClick = {
                                val perms = mutableListOf(
                                    android.Manifest.permission.SEND_SMS,
                                    android.Manifest.permission.READ_PHONE_STATE
                                )
                                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                                    perms.add(android.Manifest.permission.POST_NOTIFICATIONS)
                                }
                                permissionLauncher.launch(perms.toTypedArray())
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.error
                            )
                        ) {
                            Text("Grant Permissions")
                        }
                    }
                }
            }

            StatusCard("Connection", if (uiState.isServiceRunning) "Running" else if (uiState.isPaused) "Paused" else "Stopped")
            StatusCard("Gateway ID", uiState.gatewayId ?: "—")
            StatusCard("Gateway Name", uiState.gatewayName ?: "—")
            StatusCard("Server URL", uiState.serverUrl ?: "—")
            StatusCard("Last Heartbeat", uiState.lastHeartbeat ?: "—")
            StatusCard("SIM", uiState.simDescription)
            StatusCard("Network", uiState.networkDescription)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusCard("Submitted", uiState.sentCount.toString(), modifier = Modifier.weight(1f))
                StatusCard("Failed", uiState.failedCount.toString(), modifier = Modifier.weight(1f))
            }
            StatusCard("Current Job", uiState.currentJobId ?: "None")
            StatusCard("Last Error", uiState.lastError ?: "None")
            StatusCard("App Version", uiState.appVersion)
            StatusCard("SMS Sender", uiState.senderMode)

            Spacer(modifier = Modifier.height(8.dp))
            Button(onClick = onNavigateTestSms, modifier = Modifier.fillMaxWidth()) {
                Text("Send Test SMS")
            }
            Button(onClick = onNavigateDiagnostics, modifier = Modifier.fillMaxWidth()) {
                Text("View Diagnostics")
            }
        }
    }
}

@Composable
private fun StatusCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Text(value, style = MaterialTheme.typography.bodyLarge)
        }
    }
}
