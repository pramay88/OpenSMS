// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
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
fun SettingsScreen(
    uiState: GatewayUiState,
    onBack: () -> Unit,
    onPauseToggle: () -> Unit,
    onReregister: () -> Unit,
    onTestConnection: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Gateway: ${uiState.gatewayName ?: "—"}", style = MaterialTheme.typography.bodyLarge)
            Text("Paused: ${uiState.isPaused}", style = MaterialTheme.typography.bodyMedium)

            Button(onClick = onPauseToggle, modifier = Modifier.fillMaxWidth()) {
                Text(if (uiState.isPaused) "Resume Gateway" else "Pause Gateway")
            }
            Button(onClick = onTestConnection, modifier = Modifier.fillMaxWidth()) {
                Text("Test Connection")
            }
            uiState.connectionTestResult?.let {
                Text(it, style = MaterialTheme.typography.bodySmall)
            }
            Button(onClick = onReregister, modifier = Modifier.fillMaxWidth()) {
                Text("Re-register Gateway")
            }
        }
    }
}
