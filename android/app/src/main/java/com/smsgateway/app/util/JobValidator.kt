// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.util

import java.security.MessageDigest

object JobValidator {
    fun isExpired(expiresAtIso: String): Boolean {
        return try {
            val expires = java.time.Instant.parse(expiresAtIso)
            java.time.Instant.now().isAfter(expires)
        } catch (_: Exception) {
            true
        }
    }

    fun bodyHash(body: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val bytes = digest.digest(body.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
