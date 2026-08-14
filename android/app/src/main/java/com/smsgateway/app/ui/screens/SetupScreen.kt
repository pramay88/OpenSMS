// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.smsgateway.app.ui.GatewayViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetupScreen(
    onRegistered: () -> Unit,
    viewModel: GatewayViewModel = hiltViewModel(),
) {
    var serverUrl by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var registering by remember { mutableStateOf(false) }

    val uiState by viewModel.uiState.collectAsState()
    val sims = uiState.availableSims
    var selectedSubId by remember { mutableStateOf<Int?>(null) }
    var simExpanded by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { viewModel.refresh() }

    LaunchedEffect(Unit) {
        viewModel.refresh()
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Gateway Setup") }) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "Connect this phone to your SMS Gateway Server. You need a registration token from your server administrator.",
                style = MaterialTheme.typography.bodyMedium,
            )

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
                            "SMS and Phone permissions are needed to detect SIMs and send messages.",
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

            OutlinedTextField(
                value = serverUrl,
                onValueChange = { serverUrl = it },
                label = { Text("Gateway Server URL") },
                placeholder = { Text("https://your-server.example.com") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            OutlinedTextField(
                value = token,
                onValueChange = { token = it },
                label = { Text("Registration Token") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Gateway Name") },
                placeholder = { Text("Office Phone") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )

            if (sims.isNotEmpty()) {
                ExposedDropdownMenuBox(expanded = simExpanded, onExpandedChange = { simExpanded = it }) {
                    OutlinedTextField(
                        value = sims.find { it.subscriptionId == selectedSubId }?.displayName ?: "Default SIM",
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("SIM Subscription") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(simExpanded) },
                        modifier = Modifier.menuAnchor().fillMaxWidth(),
                    )
                    ExposedDropdownMenu(expanded = simExpanded, onDismissRequest = { simExpanded = false }) {
                        sims.forEach { sim ->
                            DropdownMenuItem(
                                text = { Text("${sim.displayName} (${sim.carrierName ?: "unknown"})") },
                                onClick = {
                                    selectedSubId = sim.subscriptionId
                                    simExpanded = false
                                },
                            )
                        }
                    }
                }
            }

            Text("Permissions", style = MaterialTheme.typography.titleSmall)
            Text("• INTERNET — connect to Gateway Server\n• SEND_SMS — send messages via SIM\n• READ_PHONE_STATE — SIM detection\n• POST_NOTIFICATIONS — service notification", style = MaterialTheme.typography.bodySmall)

            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

            Button(
                onClick = {
                    if (serverUrl.isBlank() || token.isBlank() || name.isBlank()) {
                        error = "All fields are required"
                        return@Button
                    }
                    registering = true
                    error = null
                    viewModel.register(serverUrl, token, name, selectedSubId) { success, err ->
                        registering = false
                        if (success) onRegistered() else error = err ?: "Registration failed"
                    }
                },
                enabled = !registering,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (registering) "Registering…" else "Register Gateway")
            }
            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
