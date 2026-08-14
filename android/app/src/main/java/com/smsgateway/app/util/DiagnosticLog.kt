// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.util

import java.util.concurrent.CopyOnWriteArrayList

object DiagnosticLog {
    private const val MAX_ENTRIES = 200
    private val entries = CopyOnWriteArrayList<String>()

    fun log(message: String) {
        val timestamp = java.time.Instant.now().toString()
        val redacted = message
            .replace(Regex("secret=[^\\s&]+"), "secret=[redacted]")
            .replace(Regex("Authorization: Gateway [^:]+:[^\\s]+"), "Authorization: Gateway [redacted]")
        entries.add("[$timestamp] $redacted")
        while (entries.size > MAX_ENTRIES) {
            entries.removeAt(0)
        }
    }

    fun getEntries(): List<String> = entries.toList()

    fun clear() {
        entries.clear()
    }
}
