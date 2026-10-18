// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.data.local

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class CredentialStoreTest {

    private lateinit var store: KeystoreCredentialStore

    @Before
    fun setup() {
        store = KeystoreCredentialStore(
            ApplicationProvider.getApplicationContext<Context>(),
            InMemoryCredentialStorage(),
        )
        store.clear()
    }

    @Test
    fun saveAndRetrieveCredentials() {
        val creds = GatewayCredentials(
            serverUrl = "https://example.com/",
            gatewayId = "gw-123",
            secret = "secret-abc",
            gatewayName = "Test Phone",
            subscriptionId = 1,
        )
        store.save(creds)
        assertTrue(store.isRegistered())
        val loaded = store.get()
        assertNotNull(loaded)
        assertEquals(creds.gatewayId, loaded!!.gatewayId)
        assertEquals(creds.secret, loaded.secret)
        assertEquals(creds.serverUrl, loaded.serverUrl)
    }

    @Test
    fun clearRemovesCredentials() {
        store.save(
            GatewayCredentials("https://x.com/", "id", "sec", "name", null),
        )
        store.clear()
        assertFalse(store.isRegistered())
        assertNull(store.get())
    }

    @Test
    fun pauseFlagPersists() {
        assertFalse(store.isPaused)
        store.isPaused = true
        assertTrue(store.isPaused)
    }

    private fun assertEquals(expected: String, actual: String) {
        org.junit.Assert.assertEquals(expected, actual)
    }

    private class InMemoryCredentialStorage : CredentialStorage {
        private val values = mutableMapOf<String, Any?>()

        override fun putString(key: String, value: String?) {
            if (value == null) values.remove(key) else values[key] = value
        }

        override fun getString(key: String): String? = values[key] as? String

        override fun putInt(key: String, value: Int?) {
            if (value == null) values.remove(key) else values[key] = value
        }

        override fun getInt(key: String): Int? = values[key] as? Int

        override fun putBoolean(key: String, value: Boolean) {
            values[key] = value
        }

        override fun getBoolean(key: String, defaultValue: Boolean): Boolean =
            values[key] as? Boolean ?: defaultValue

        override fun clear() {
            values.clear()
        }
    }
}
