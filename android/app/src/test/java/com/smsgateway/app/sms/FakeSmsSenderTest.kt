// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.sms

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class FakeSmsSenderTest {

    private lateinit var sender: FakeSmsSender

    @Before
    fun setup() {
        sender = FakeSmsSender()
    }

    @Test
    fun send_recordsMessage() = runTest {
        val result = sender.send("+12025550100", "Hello", null)
        assertTrue(result.isSuccess)
        assertEquals(1, sender.sentMessages.size)
        assertEquals("+12025550100" to "Hello", sender.sentMessages[0])
    }

    @Test
    fun send_failureWhenConfigured() = runTest {
        sender.shouldFail = true
        val result = sender.send("+12025550100", "Hello", null)
        assertTrue(result.isFailure)
        assertEquals(0, sender.sentMessages.size)
    }

    @Test
    fun send_canSimulateDeliveryCallback() = runTest {
        sender.deliverImmediately = true
        var callback: SmsDeliveryResult? = null

        val result = sender.send("+12025550100", "Hello", null) { callback = it }

        assertTrue(result.isSuccess)
        assertEquals(SmsDeliveryStatus.DELIVERED, callback?.status)
    }
}
