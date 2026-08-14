// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.device

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat

data class SimInfo(
    val subscriptionId: Int,
    val displayName: String,
    val carrierName: String?,
    val slotIndex: Int,
)

data class SimStatus(
    val hasSim: Boolean,
    val sims: List<SimInfo>,
    val isAirplaneMode: Boolean,
    val hasCellular: Boolean,
    val description: String,
)

class SimManager(private val context: Context) {

    fun getSimStatus(): SimStatus {
        val airplane = isAirplaneModeOn()
        val sims = getAvailableSims()
        val hasSim = sims.isNotEmpty()
        val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
        val hasCellular = !airplane && telephony.simState == TelephonyManager.SIM_STATE_READY

        val description = when {
            airplane -> "Airplane mode is on"
            !hasSim -> "No SIM detected"
            telephony.simState != TelephonyManager.SIM_STATE_READY -> "SIM not ready"
            else -> "SIM ready (${sims.size} subscription(s))"
        }

        return SimStatus(hasSim, sims, airplane, hasCellular, description)
    }

    fun getAvailableSims(): List<SimInfo> {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return emptyList()
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP_MR1) {
            return emptyList()
        }

        val subscriptionManager = context.getSystemService(SubscriptionManager::class.java)
            ?: return emptyList()

        return subscriptionManager.activeSubscriptionInfoList?.map { info ->
            SimInfo(
                subscriptionId = info.subscriptionId,
                displayName = info.displayName?.toString() ?: "SIM ${info.simSlotIndex + 1}",
                carrierName = info.carrierName?.toString(),
                slotIndex = info.simSlotIndex,
            )
        } ?: emptyList()
    }

    private fun isAirplaneModeOn(): Boolean {
        return android.provider.Settings.Global.getInt(
            context.contentResolver,
            android.provider.Settings.Global.AIRPLANE_MODE_ON,
            0,
        ) != 0
    }
}
