// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.sms

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import com.smsgateway.app.util.DiagnosticLog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.util.UUID
import kotlin.coroutines.resume

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
            withContext(Dispatchers.Main) {
                withTimeout(45000) { // 45 second timeout for Android SMS stack
                    executeSend(to, message, subscriptionId)
                }
            }
        } catch (_: TimeoutCancellationException) {
            DiagnosticLog.log("SMS send timeout for ${redactPhone(to)}")
            Result.failure(SmsException("SMS send timed out after 45s", "TIMEOUT"))
        } catch (e: Exception) {
            if (e is SmsException) Result.failure(e)
            else {
                DiagnosticLog.log("SMS trigger failed for ${redactPhone(to)}: ${e.message}")
                Result.failure(SmsException(e.message ?: "SMS send failed", "SMS_FAILED", e))
            }
        }
    }

    private suspend fun executeSend(to: String, message: String, subscriptionId: Int?): Result<Unit> =
        suspendCancellableCoroutine { continuation ->
            val smsManager = getSmsManager(subscriptionId)
            val parts = smsManager.divideMessage(message)
            val requestId = UUID.randomUUID().toString()
            val sentAction = "com.smsgateway.app.SMS_SENT_$requestId"

            val receiver = object : BroadcastReceiver() {
                private var partsResponded = 0
                private var alreadyResponded = false

                override fun onReceive(context: Context, intent: Intent) {
                    if (alreadyResponded) return

                    val resultCode = resultCode
                    if (resultCode != Activity.RESULT_OK) {
                        alreadyResponded = true
                        val errorCode = mapResultCodeToErrorCode(resultCode)
                        DiagnosticLog.log("SMS failed for ${redactPhone(to)}: $errorCode ($resultCode)")
                        if (continuation.isActive) {
                            continuation.resume(Result.failure(SmsException("Android reported error: $errorCode", errorCode)))
                        }
                        try {
                            context.unregisterReceiver(this)
                        } catch (e: Exception) {
                            // Already unregistered or context invalid
                        }
                        return
                    }

                    partsResponded++
                    if (partsResponded == parts.size) {
                        alreadyResponded = true
                        DiagnosticLog.log("SMS sent successfully to ${redactPhone(to)} (${parts.size} parts)")
                        if (continuation.isActive) {
                            continuation.resume(Result.success(Unit))
                        }
                        try {
                            context.unregisterReceiver(this)
                        } catch (e: Exception) {
                            // Already unregistered or context invalid
                        }
                    }
                }
            }

            val filter = IntentFilter(sentAction)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                context.registerReceiver(receiver, filter)
            }

            continuation.invokeOnCancellation {
                try {
                    context.unregisterReceiver(receiver)
                } catch (e: Exception) {
                    // Ignore cleanup errors
                }
            }

            try {
                val sentIntents = ArrayList((0 until parts.size).map { index ->
                    val intent = Intent(sentAction)
                    PendingIntent.getBroadcast(
                        context,
                        index, // Unique request code per part
                        intent,
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                    )
                })

                if (parts.size == 1) {
                    smsManager.sendTextMessage(to, null, parts[0], sentIntents[0], null)
                } else {
                    smsManager.sendMultipartTextMessage(to, null, parts, sentIntents, null)
                }
            } catch (e: Exception) {
                if (continuation.isActive) {
                    continuation.resume(Result.failure(SmsException(e.message ?: "Failed to trigger SMS", "TRIGGER_FAILED", e)))
                }
                try {
                    context.unregisterReceiver(receiver)
                } catch (_: Exception) { }
            }
        }

    private fun redactPhone(phone: String): String {
        return if (phone.length >= 6) {
            phone.substring(0, 3) + "***" + phone.substring(phone.length - 3)
        } else {
            "***"
        }
    }

    private fun mapResultCodeToErrorCode(resultCode: Int): String {
        return when (resultCode) {
            SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "GENERIC_FAILURE"
            SmsManager.RESULT_ERROR_NO_SERVICE -> "NO_SERVICE"
            SmsManager.RESULT_ERROR_NULL_PDU -> "NULL_PDU"
            SmsManager.RESULT_ERROR_RADIO_OFF -> "RADIO_OFF"
            10 -> "LIMIT_EXCEEDED" // RESULT_ERROR_LIMIT_EXCEEDED
            11 -> "FDN_CHECK_FAILURE" // RESULT_ERROR_FDN_CHECK_FAILURE
            15 -> "SHORT_CODE_NOT_ALLOWED"
            16 -> "SHORT_CODE_NEVER_ALLOWED"
            else -> "ERROR_$resultCode"
        }
    }

    @Suppress("DEPRECATION")
    private fun getSmsManager(subscriptionId: Int?): SmsManager {
        val baseSmsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(SmsManager::class.java)
        } else {
            SmsManager.getDefault()
        }

        return if (subscriptionId != null && subscriptionId != -1) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                baseSmsManager.createForSubscriptionId(subscriptionId)
            } else {
                SmsManager.getSmsManagerForSubscriptionId(subscriptionId)
            }
        } else {
            baseSmsManager
        }
    }
}

class SmsException(
    message: String,
    val errorCode: String,
    cause: Throwable? = null,
) : Exception(message, cause)
