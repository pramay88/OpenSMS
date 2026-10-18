// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.di

import android.content.Context
import androidx.room.Room
import com.smsgateway.app.BuildConfig
import com.smsgateway.app.data.api.GatewayApi
import com.smsgateway.app.data.local.CredentialStore
import com.smsgateway.app.data.local.GatewayDatabase
import com.smsgateway.app.data.local.JobRepository
import com.smsgateway.app.data.local.KeystoreCredentialStore
import com.smsgateway.app.data.local.RoomJobRepository
import com.smsgateway.app.device.NetworkMonitor
import com.smsgateway.app.device.SimManager
import com.smsgateway.app.domain.GatewayRepository
import com.smsgateway.app.domain.JobProcessor
import com.smsgateway.app.sms.AndroidSmsSender
import com.smsgateway.app.sms.FakeSmsSender
import com.smsgateway.app.sms.SmsSender
import com.smsgateway.app.util.DiagnosticLog
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideCredentialStore(@ApplicationContext context: Context): CredentialStore {
        return KeystoreCredentialStore(context)
    }

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): GatewayDatabase {
        return Room.databaseBuilder(context, GatewayDatabase::class.java, "gateway.db")
            .fallbackToDestructiveMigration()
            .build()
    }

    @Provides
    @Singleton
    fun provideJobRepository(db: GatewayDatabase): JobRepository {
        return RoomJobRepository(db.sentJobDao())
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(): OkHttpClient {
        val builder = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
        if (BuildConfig.DEBUG) {
            builder.addInterceptor(
                HttpLoggingInterceptor().apply {
                    level = HttpLoggingInterceptor.Level.HEADERS
                    redactHeader("Authorization")
                },
            )
        }
        return builder.build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(okHttpClient: OkHttpClient, credentialStore: CredentialStore): Retrofit {
        val baseUrl = credentialStore.get()?.serverUrl ?: "https://localhost/"
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    @Provides
    @Singleton
    fun provideGatewayApi(retrofit: Retrofit): GatewayApi {
        return retrofit.create(GatewayApi::class.java)
    }

    @Provides
    @Singleton
    fun provideApiProvider(
        okHttpClient: OkHttpClient,
        credentialStore: CredentialStore,
    ): @JvmSuppressWildcards () -> GatewayApi {
        return {
            val baseUrl = credentialStore.get()?.serverUrl ?: "https://localhost/"
            Retrofit.Builder()
                .baseUrl(baseUrl)
                .client(okHttpClient)
                .addConverterFactory(GsonConverterFactory.create())
                .build()
                .create(GatewayApi::class.java)
        }
    }

    @Provides
    @Singleton
    fun provideSmsSender(@ApplicationContext context: Context): SmsSender {
        return if (BuildConfig.USE_FAKE_SMS) {
            DiagnosticLog.log("SMS sender: FakeSmsSender (${BuildConfig.BUILD_TYPE})")
            FakeSmsSender()
        } else {
            DiagnosticLog.log("SMS sender: AndroidSmsSender (${BuildConfig.BUILD_TYPE})")
            AndroidSmsSender(context)
        }
    }

    @Provides
    @Singleton
    fun provideSimManager(@ApplicationContext context: Context): SimManager {
        return SimManager(context)
    }

    @Provides
    @Singleton
    fun provideNetworkMonitor(@ApplicationContext context: Context): NetworkMonitor {
        return NetworkMonitor(context)
    }

    @Provides
    @Singleton
    fun provideJobProcessor(
        apiProvider: @JvmSuppressWildcards () -> GatewayApi,
        credentialStore: CredentialStore,
        jobRepository: JobRepository,
        smsSender: SmsSender,
    ): JobProcessor {
        return JobProcessor(apiProvider, credentialStore, jobRepository, smsSender)
    }

    @Provides
    @Singleton
    fun provideGatewayRepository(
        apiProvider: @JvmSuppressWildcards () -> GatewayApi,
        credentialStore: CredentialStore,
        okHttpClient: OkHttpClient,
    ): GatewayRepository {
        return GatewayRepository(apiProvider, credentialStore, okHttpClient)
    }
}
