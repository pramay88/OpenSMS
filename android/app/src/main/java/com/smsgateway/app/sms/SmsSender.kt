// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.sms

interface SmsSender {
    suspend fun send(
        to: String,
        message: String,
        subscriptionId: Int?,
        onDelivery: (SmsDeliveryResult) -> Unit = {},
    ): Result<Unit>
}

enum class SmsDeliveryStatus {
    DELIVERED,
    FAILED,
    UNKNOWN,
}

data class SmsDeliveryResult(
    val status: SmsDeliveryStatus,
    val errorCode: String? = null,
    val errorMessage: String? = null,
)
