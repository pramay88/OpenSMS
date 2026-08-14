// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.sms

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.SmsManager
import androidx.core.content.ContextCompat

class AndroidSmsSender(
    private val context: Context,
) : SmsSender {

    override suspend fun send(to: String, message: String, subscriptionId: Int?): Result<Unit> {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return Result.failure(SmsException("SMS permission not granted", "PERMISSION_DENIED"))
        }

        return try {
            val smsManager = getSmsManager(subscriptionId)
            val parts = smsManager.divideMessage(message)
            if (parts.size == 1) {
                smsManager.sendTextMessage(to, null, message, null, null)
            } else {
                smsManager.sendMultipartTextMessage(to, null, parts, null, null)
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(SmsException(e.message ?: "SMS send failed", "SMS_FAILED", e))
        }
    }

    @Suppress("DEPRECATION")
    private fun getSmsManager(subscriptionId: Int?): SmsManager {
        return if (subscriptionId != null && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP_MR1) {
            SmsManager.getSmsManagerForSubscriptionId(subscriptionId)
        } else {
            SmsManager.getDefault()
        }
    }
}

class SmsException(
    message: String,
    val errorCode: String,
    cause: Throwable? = null,
) : Exception(message, cause)
