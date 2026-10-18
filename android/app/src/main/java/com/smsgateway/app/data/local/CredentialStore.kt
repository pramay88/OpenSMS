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

interface CredentialStorage {
    fun putString(key: String, value: String?)
    fun getString(key: String): String?
    fun putInt(key: String, value: Int?)
    fun getInt(key: String): Int?
    fun putBoolean(key: String, value: Boolean)
    fun getBoolean(key: String, defaultValue: Boolean): Boolean
    fun clear()
}

private class SharedPreferencesCredentialStorage(
    private val prefs: SharedPreferences,
) : CredentialStorage {
    override fun putString(key: String, value: String?) {
        prefs.edit().apply {
            if (value == null) remove(key) else putString(key, value)
        }.apply()
    }

    override fun getString(key: String): String? = prefs.getString(key, null)

    override fun putInt(key: String, value: Int?) {
        prefs.edit().apply {
            if (value == null) remove(key) else putInt(key, value)
        }.apply()
    }

    override fun getInt(key: String): Int? =
        if (prefs.contains(key)) prefs.getInt(key, -1).takeIf { it >= 0 } else null

    override fun putBoolean(key: String, value: Boolean) {
        prefs.edit().putBoolean(key, value).apply()
    }

    override fun getBoolean(key: String, defaultValue: Boolean): Boolean =
        prefs.getBoolean(key, defaultValue)

    override fun clear() {
        prefs.edit().clear().apply()
    }
}

class KeystoreCredentialStore(
    context: Context,
    storage: CredentialStorage? = null,
) : CredentialStore {
    private val storage: CredentialStorage

    init {
        this.storage = storage ?: run {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            SharedPreferencesCredentialStorage(
                EncryptedSharedPreferences.create(
                    context,
                    PREFS_NAME,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                ),
            )
        }
    }

    override fun save(credentials: GatewayCredentials) {
        storage.putString(KEY_SERVER_URL, credentials.serverUrl)
        storage.putString(KEY_GATEWAY_ID, credentials.gatewayId)
        storage.putString(KEY_SECRET, credentials.secret)
        storage.putString(KEY_GATEWAY_NAME, credentials.gatewayName)
        storage.putInt(KEY_SUBSCRIPTION_ID, credentials.subscriptionId)
    }

    override fun get(): GatewayCredentials? {
        val serverUrl = storage.getString(KEY_SERVER_URL) ?: return null
        val gatewayId = storage.getString(KEY_GATEWAY_ID) ?: return null
        val secret = storage.getString(KEY_SECRET) ?: return null
        val name = storage.getString(KEY_GATEWAY_NAME) ?: return null
        val subId = storage.getInt(KEY_SUBSCRIPTION_ID)
        return GatewayCredentials(serverUrl, gatewayId, secret, name, subId)
    }

    override fun clear() {
        storage.clear()
    }

    override fun isRegistered(): Boolean = get() != null

    override var isPaused: Boolean
        get() = storage.getBoolean(KEY_PAUSED, false)
        set(value) = storage.putBoolean(KEY_PAUSED, value)

    override var selectedSubscriptionId: Int?
        get() = storage.getInt(KEY_SUBSCRIPTION_ID)
        set(value) = storage.putInt(KEY_SUBSCRIPTION_ID, value)

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
