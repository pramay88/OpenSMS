// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.sms

import kotlinx.coroutines.delay

class FakeSmsSender(
    var shouldFail: Boolean = false,
    var failureCode: String = "FAKE_FAILURE",
    var delayMs: Long = 50,
    var deliverImmediately: Boolean = false,
) : SmsSender {
    val sentMessages = mutableListOf<Pair<String, String>>()

    override suspend fun send(
        to: String,
        message: String,
        subscriptionId: Int?,
        onDelivery: (SmsDeliveryResult) -> Unit,
    ): Result<Unit> {
        delay(delayMs)
        if (shouldFail) {
            return Result.failure(SmsException("Fake SMS failure", failureCode))
        }
        sentMessages.add(to to message)
        com.smsgateway.app.util.DiagnosticLog.log("FAKE SMS: To $to")
        if (deliverImmediately) {
            onDelivery(SmsDeliveryResult(SmsDeliveryStatus.DELIVERED))
        }
        return Result.success(Unit)
    }

    fun reset() {
        sentMessages.clear()
        shouldFail = false
    }
}
