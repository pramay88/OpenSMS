// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.smsgateway.app.data.local.CredentialStore
import com.smsgateway.app.service.GatewayForegroundService
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class BootReceiver : BroadcastReceiver() {

    @Inject lateinit var credentialStore: CredentialStore

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action == Intent.ACTION_BOOT_COMPLETED && credentialStore.isRegistered()) {
            if (!credentialStore.isPaused) {
                GatewayForegroundService.start(context)
            }
        }
    }
}
