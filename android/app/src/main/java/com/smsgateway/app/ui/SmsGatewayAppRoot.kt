// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.smsgateway.app.ui.screens.DashboardScreen
import com.smsgateway.app.ui.screens.DiagnosticsScreen
import com.smsgateway.app.ui.screens.SetupScreen
import com.smsgateway.app.ui.screens.SettingsScreen
import com.smsgateway.app.ui.screens.TestSmsScreen

@Composable
fun SmsGatewayAppRoot(viewModel: GatewayViewModel = hiltViewModel()) {
    val navController = rememberNavController()
    val uiState by viewModel.uiState.collectAsState()

    val startDestination = if (uiState.isRegistered) "dashboard" else "setup"

    NavHost(navController = navController, startDestination = startDestination) {
        composable("setup") {
            SetupScreen(
                onRegistered = {
                    navController.navigate("dashboard") {
                        popUpTo("setup") { inclusive = true }
                    }
                },
            )
        }
        composable("dashboard") {
            DashboardScreen(
                uiState = uiState,
                onNavigateSettings = { navController.navigate("settings") },
                onNavigateDiagnostics = { navController.navigate("diagnostics") },
                onNavigateTestSms = { navController.navigate("test_sms") },
                onRefresh = { viewModel.refresh() },
            )
        }
        composable("settings") {
            SettingsScreen(
                uiState = uiState,
                onBack = { navController.popBackStack() },
                onPauseToggle = { viewModel.togglePause() },
                onReregister = {
                    viewModel.clearCredentials()
                    navController.navigate("setup") {
                        popUpTo("dashboard") { inclusive = true }
                    }
                },
                onTestConnection = { viewModel.testConnection() },
            )
        }
        composable("diagnostics") {
            DiagnosticsScreen(onBack = { navController.popBackStack() })
        }
        composable("test_sms") {
            TestSmsScreen(
                onBack = { navController.popBackStack() },
                onSend = { to, msg -> viewModel.sendTestSms(to, msg) },
                testResult = uiState.testSmsResult,
            )
        }
    }
}
