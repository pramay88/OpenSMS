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
import android.os.Handler
import android.os.Looper
import android.telephony.SmsManager
import android.telephony.TelephonyManager
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

    override suspend fun send(
        to: String,
        message: String,
        subscriptionId: Int?,
        onDelivery: (SmsDeliveryResult) -> Unit,
    ): Result<Unit> {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return Result.failure(SmsException("SMS permission not granted", "PERMISSION_DENIED"))
        }
        val normalizedTo = to.trim().replace(" ", "")
        if (normalizedTo.isBlank() || !android.telephony.PhoneNumberUtils.isGlobalPhoneNumber(normalizedTo)) {
            return Result.failure(SmsException("Recipient must be a valid international phone number", "INVALID_RECIPIENT"))
        }
        val telephony = context.getSystemService(TelephonyManager::class.java)
        if (telephony?.simState != TelephonyManager.SIM_STATE_READY) {
            return Result.failure(SmsException("No ready SIM is available", "SIM_NOT_READY"))
        }

        return try {
            withContext(Dispatchers.Main) {
                withTimeout(45000) { // 45 second timeout for Android SMS stack
                    executeSend(normalizedTo, message, subscriptionId, onDelivery)
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

    private suspend fun executeSend(
        to: String,
        message: String,
        subscriptionId: Int?,
        onDelivery: (SmsDeliveryResult) -> Unit,
    ): Result<Unit> =
        suspendCancellableCoroutine { continuation ->
            val smsManager = getSmsManager(subscriptionId)
            val parts = smsManager.divideMessage(message)
            val requestId = UUID.randomUUID().toString()
            val sentAction = "com.smsgateway.app.SMS_SENT_$requestId"
            val deliveryAction = "com.smsgateway.app.SMS_DELIVERED_$requestId"

            val receiver = object : BroadcastReceiver() {
                private var sentParts = 0
                private var deliveryParts = 0
                private var sentReported = false
                private var deliveryReported = false

                override fun onReceive(context: Context, intent: Intent) {
                    val resultCode = resultCode
                    val action = intent.action
                    if (action == sentAction) {
                        if (resultCode != Activity.RESULT_OK) {
                            if (sentReported) return
                            sentReported = true
                            val errorCode = mapResultCodeToErrorCode(resultCode)
                            DiagnosticLog.log("SMS submission failed for ${redactPhone(to)}: $errorCode ($resultCode)")
                            if (continuation.isActive) {
                                continuation.resume(
                                    Result.failure(SmsException("Android reported error: $errorCode", errorCode))
                                )
                            }
                            cleanup()
                            return
                        }
                        sentParts++
                        if (sentParts == parts.size && !sentReported) {
                            sentReported = true
                            DiagnosticLog.log("SMS submission accepted for ${redactPhone(to)} (${parts.size} parts)")
                            if (continuation.isActive) continuation.resume(Result.success(Unit))
                        }
                    } else if (action == deliveryAction) {
                        if (resultCode != Activity.RESULT_OK) {
                            if (deliveryReported) return
                            deliveryReported = true
                            val errorCode = mapResultCodeToErrorCode(resultCode)
                            onDelivery(
                                SmsDeliveryResult(
                                    SmsDeliveryStatus.FAILED,
                                    errorCode,
                                    "Carrier delivery failed: $errorCode",
                                )
                            )
                            cleanup()
                            return
                        }
                        deliveryParts++
                        if (deliveryParts == parts.size && !deliveryReported) {
                            deliveryReported = true
                            onDelivery(SmsDeliveryResult(SmsDeliveryStatus.DELIVERED))
                            cleanup()
                        }
                    }
                }

                private fun cleanup() {
                    try {
                        context.unregisterReceiver(this)
                    } catch (_: Exception) {
                        // Receiver may already be unregistered after cancellation.
                    }
                }
            }

            val filter = IntentFilter().apply {
                addAction(sentAction)
                addAction(deliveryAction)
            }
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
                val deliveryIntents = ArrayList((0 until parts.size).map { index ->
                    val intent = Intent(deliveryAction)
                    PendingIntent.getBroadcast(
                        context,
                        parts.size + index,
                        intent,
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                    )
                })

                if (parts.size == 1) {
                    smsManager.sendTextMessage(to, null, parts[0], sentIntents[0], deliveryIntents[0])
                } else {
                    smsManager.sendMultipartTextMessage(to, null, parts, sentIntents, deliveryIntents)
                }
                Handler(Looper.getMainLooper()).postDelayed({
                    try {
                        context.unregisterReceiver(receiver)
                        DiagnosticLog.log("No delivery receipt received for ${redactPhone(to)}")
                    } catch (_: Exception) {
                        // Already unregistered after a delivery callback.
                    }
                }, DELIVERY_RECEIPT_TIMEOUT_MS)
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

    private companion object {
        const val DELIVERY_RECEIPT_TIMEOUT_MS = 10 * 60 * 1000L
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
