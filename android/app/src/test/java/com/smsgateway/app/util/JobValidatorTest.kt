// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.util

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class JobValidatorTest {

    @Test
    fun isExpired_returnsTrueForPastDate() {
        val past = Instant.now().minusSeconds(60).toString()
        assertTrue(JobValidator.isExpired(past))
    }

    @Test
    fun isExpired_returnsFalseForFutureDate() {
        val future = Instant.now().plusSeconds(3600).toString()
        assertFalse(JobValidator.isExpired(future))
    }

    @Test
    fun bodyHash_isDeterministic() {
        val hash1 = JobValidator.bodyHash("test message")
        val hash2 = JobValidator.bodyHash("test message")
        assertEquals(hash1, hash2)
    }

    @Test
    fun bodyHash_differsForDifferentBodies() {
        val hash1 = JobValidator.bodyHash("message a")
        val hash2 = JobValidator.bodyHash("message b")
        assertTrue(hash1 != hash2)
    }

    private fun assertEquals(a: String, b: String) {
        org.junit.Assert.assertEquals(a, b)
    }
}
