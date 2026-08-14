// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.data.local

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

data class GatewayCredentials(
    val serverUrl: String,
    val gatewayId: String,
    val secret: String,
    val gatewayName: String,
    val subscriptionId: Int?,
)

interface CredentialStore {
    fun save(credentials: GatewayCredentials)
    fun get(): GatewayCredentials?
    fun clear()
    fun isRegistered(): Boolean
    var isPaused: Boolean
    var selectedSubscriptionId: Int?
}

class KeystoreCredentialStore(context: Context) : CredentialStore {
    private val prefs: SharedPreferences

    init {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        prefs = EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    override fun save(credentials: GatewayCredentials) {
        prefs.edit()
            .putString(KEY_SERVER_URL, credentials.serverUrl)
            .putString(KEY_GATEWAY_ID, credentials.gatewayId)
            .putString(KEY_SECRET, credentials.secret)
            .putString(KEY_GATEWAY_NAME, credentials.gatewayName)
            .apply {
                if (credentials.subscriptionId != null) {
                    putInt(KEY_SUBSCRIPTION_ID, credentials.subscriptionId)
                } else {
                    remove(KEY_SUBSCRIPTION_ID)
                }
            }
            .apply()
    }

    override fun get(): GatewayCredentials? {
        val serverUrl = prefs.getString(KEY_SERVER_URL, null) ?: return null
        val gatewayId = prefs.getString(KEY_GATEWAY_ID, null) ?: return null
        val secret = prefs.getString(KEY_SECRET, null) ?: return null
        val name = prefs.getString(KEY_GATEWAY_NAME, null) ?: return null
        val subId = if (prefs.contains(KEY_SUBSCRIPTION_ID)) {
            prefs.getInt(KEY_SUBSCRIPTION_ID, -1).takeIf { it >= 0 }
        } else {
            null
        }
        return GatewayCredentials(serverUrl, gatewayId, secret, name, subId)
    }

    override fun clear() {
        prefs.edit().clear().apply()
    }

    override fun isRegistered(): Boolean = get() != null

    override var isPaused: Boolean
        get() = prefs.getBoolean(KEY_PAUSED, false)
        set(value) {
            prefs.edit().putBoolean(KEY_PAUSED, value).apply()
        }

    override var selectedSubscriptionId: Int?
        get() = if (prefs.contains(KEY_SUBSCRIPTION_ID)) {
            prefs.getInt(KEY_SUBSCRIPTION_ID, -1).takeIf { it >= 0 }
        } else {
            null
        }
        set(value) {
            prefs.edit().apply {
                if (value != null) putInt(KEY_SUBSCRIPTION_ID, value) else remove(KEY_SUBSCRIPTION_ID)
            }.apply()
        }

    companion object {
        private const val PREFS_NAME = "gateway_credentials"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_GATEWAY_ID = "gateway_id"
        private const val KEY_SECRET = "secret"
        private const val KEY_GATEWAY_NAME = "gateway_name"
        private const val KEY_SUBSCRIPTION_ID = "subscription_id"
        private const val KEY_PAUSED = "paused"
    }
}
