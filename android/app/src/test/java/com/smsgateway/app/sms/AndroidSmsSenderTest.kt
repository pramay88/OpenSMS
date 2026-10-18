// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.sms

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import io.mockk.unmockkStatic
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidSmsSenderTest {

    @Test
    fun send_returnsPermissionDeniedBeforeTouchingTelephony() = runTest {
        val context = mockk<Context>()
        mockkStatic(ContextCompat::class)
        every {
            ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS)
        } returns PackageManager.PERMISSION_DENIED

        try {
            val result = AndroidSmsSender(context).send("+12025550100", "Hello", null)
            assertTrue(result.isFailure)
            assertEquals("PERMISSION_DENIED", (result.exceptionOrNull() as SmsException).errorCode)
        } finally {
            unmockkStatic(ContextCompat::class)
        }
    }
}
