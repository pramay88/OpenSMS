// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.sms

interface SmsSender {
    suspend fun send(to: String, message: String, subscriptionId: Int?): Result<Unit>
}
