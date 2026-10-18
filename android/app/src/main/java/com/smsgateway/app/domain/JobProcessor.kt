// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.domain

import com.smsgateway.app.BuildConfig
import com.smsgateway.app.data.api.GatewayApi
import com.smsgateway.app.data.api.JobDto
import com.smsgateway.app.data.api.JobResultRequest
import com.smsgateway.app.data.local.CredentialStore
import com.smsgateway.app.data.local.GatewayCredentials
import com.smsgateway.app.data.local.JobRepository
import com.smsgateway.app.sms.SmsException
import com.smsgateway.app.sms.SmsDeliveryResult
import com.smsgateway.app.sms.SmsDeliveryStatus
import com.smsgateway.app.sms.SmsSender
import com.smsgateway.app.util.DiagnosticLog
import com.smsgateway.app.util.JobValidator
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.Instant

data class GatewayStats(
    val sentCount: Int = 0,
    val failedCount: Int = 0,
    val lastError: String? = null,
    val currentJobId: String? = null,
    val lastHeartbeat: String? = null,
)

class JobProcessor(
    private val apiProvider: () -> GatewayApi,
    private val credentialStore: CredentialStore,
    private val jobRepository: JobRepository,
    private val smsSender: SmsSender,
) {
    private val callbackScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _stats = MutableStateFlow(GatewayStats())
    val stats: StateFlow<GatewayStats> = _stats.asStateFlow()

    private fun authHeader(creds: GatewayCredentials): String =
        "Gateway ${creds.gatewayId}:${creds.secret}"

    suspend fun replayUnreportedResults() {
        val creds = credentialStore.get() ?: return
        val api = apiProvider()
        for (job in jobRepository.getUnreportedJobs()) {
            try {
                api.reportResult(
                    authHeader(creds),
                    job.jobId,
                    JobResultRequest(
                        success = job.success,
                        deliveryStatus = job.deliveryStatus ?: if (job.success) "SUBMITTED" else "DELIVERY_FAILED",
                        errorCode = job.errorCode,
                        errorMessage = job.errorMessage,
                    ),
                )
                jobRepository.markReported(job.jobId)
                DiagnosticLog.log("Replayed result for job ${job.jobId}")
            } catch (e: Exception) {
                DiagnosticLog.log("Failed to replay result for ${job.jobId}: ${e.message}")
            }
        }
    }

    suspend fun processJob(job: JobDto, subscriptionId: Int?) {
        if (JobValidator.isExpired(job.expiresAt)) {
            DiagnosticLog.log("Skipping expired job ${job.id}")
            reportFailure(job, "JOB_EXPIRED", "Job expired before processing")
            return
        }

        val existing = jobRepository.getJob(job.id)
        if (existing != null && existing.success) {
            DiagnosticLog.log("Skipping duplicate job ${job.id} (already sent locally)")
            reportSubmission(job)
            return
        }

        val creds = credentialStore.get() ?: return
        val api = apiProvider()
        _stats.value = _stats.value.copy(currentJobId = job.id)

        try {
            val acknowledged = api.ackJob(authHeader(creds), job.id)
            if (acknowledged.status != "SENDING") {
                DiagnosticLog.log("Ack returned unexpected status for ${job.id}: ${acknowledged.status}")
                _stats.value = _stats.value.copy(currentJobId = null)
                return
            }
        } catch (e: Exception) {
            DiagnosticLog.log("Ack failed for ${job.id}: ${e.message}")
            _stats.value = _stats.value.copy(currentJobId = null, lastError = "Job acknowledgement failed")
            return
        }

        val hash = JobValidator.bodyHash(job.message)
        jobRepository.savePendingResult(job.id, job.to, hash, success = false)

        val result = smsSender.send(job.to, job.message, subscriptionId) { delivery ->
            callbackScope.launch {
                reportDelivery(job, delivery)
            }
        }
        result.fold(
            onSuccess = {
                jobRepository.savePendingResult(
                    job.id,
                    job.to,
                    hash,
                    success = true,
                    deliveryStatus = "SUBMITTED",
                )
                reportSubmission(job)
                _stats.value = _stats.value.copy(
                    sentCount = _stats.value.sentCount + 1,
                    currentJobId = null,
                    lastError = null,
                )
            },
            onFailure = { err ->
                val code = (err as? SmsException)?.errorCode ?: "SEND_FAILED"
                val msg = err.message ?: "Send failed"
                jobRepository.savePendingResult(job.id, job.to, hash, success = false, code, msg)
                reportFailure(job, code, msg)
                _stats.value = _stats.value.copy(
                    failedCount = _stats.value.failedCount + 1,
                    currentJobId = null,
                    lastError = msg,
                )
            },
        )
    }

    private suspend fun reportSubmission(job: JobDto) {
        val creds = credentialStore.get() ?: return
        try {
            apiProvider().reportResult(
                authHeader(creds),
                job.id,
                JobResultRequest(success = true, deliveryStatus = "SUBMITTED"),
            )
            jobRepository.markReported(job.id)
        } catch (e: Exception) {
            DiagnosticLog.log("Report success failed for ${job.id}: ${e.message}")
        }

    }

    private suspend fun reportDelivery(job: JobDto, delivery: SmsDeliveryResult) {
        val creds = credentialStore.get() ?: return
        val success = delivery.status != SmsDeliveryStatus.FAILED
        val deliveryStatus = when (delivery.status) {
            SmsDeliveryStatus.DELIVERED -> "DELIVERED"
            SmsDeliveryStatus.FAILED -> "DELIVERY_FAILED"
            SmsDeliveryStatus.UNKNOWN -> "UNKNOWN"
        }
        jobRepository.savePendingResult(
            job.id,
            job.to,
            JobValidator.bodyHash(job.message),
            success = success,
            errorCode = delivery.errorCode,
            errorMessage = delivery.errorMessage,
            deliveryStatus = deliveryStatus,
        )
        try {
            apiProvider().reportResult(
                authHeader(creds),
                job.id,
                JobResultRequest(
                    success = success,
                    deliveryStatus = deliveryStatus,
                    errorCode = delivery.errorCode,
                    errorMessage = delivery.errorMessage,
                ),
            )
            DiagnosticLog.log("Delivery callback reported for ${job.id}: ${delivery.status}")
        } catch (e: Exception) {
            DiagnosticLog.log("Delivery callback report failed for ${job.id}: ${e.message}")
        }
    }

    private suspend fun reportFailure(job: JobDto, code: String, message: String) {
        val creds = credentialStore.get() ?: return
        try {
            apiProvider().reportResult(
                authHeader(creds),
                job.id,
                JobResultRequest(success = false, errorCode = code, errorMessage = message),
            )
            jobRepository.markReported(job.id)
        } catch (e: Exception) {
            DiagnosticLog.log("Report failure failed for ${job.id}: ${e.message}")
        }
    }

    fun updateHeartbeat() {
        _stats.value = _stats.value.copy(lastHeartbeat = Instant.now().toString())
    }
}

class GatewayRepository(
    private val apiProvider: () -> GatewayApi,
    private val credentialStore: CredentialStore,
    private val okHttpClient: okhttp3.OkHttpClient,
) {
    private fun apiForUrl(serverUrl: String): GatewayApi {
        val normalizedUrl = serverUrl.trim().trimEnd('/') + "/"
        return retrofit2.Retrofit.Builder()
            .baseUrl(normalizedUrl)
            .client(okHttpClient)
            .addConverterFactory(retrofit2.converter.gson.GsonConverterFactory.create())
            .build()
            .create(GatewayApi::class.java)
    }

    suspend fun register(serverUrl: String, token: String, name: String): GatewayCredentials {
        val normalizedUrl = serverUrl.trim().trimEnd('/') + "/"
        val api = apiForUrl(normalizedUrl)
        val response = api.register(
            com.smsgateway.app.data.api.RegisterRequest(token, name),
        )
        val creds = GatewayCredentials(
            serverUrl = normalizedUrl,
            gatewayId = response.gatewayId,
            secret = response.secret,
            gatewayName = name,
            subscriptionId = credentialStore.selectedSubscriptionId,
        )
        credentialStore.save(creds)
        DiagnosticLog.log("Registered gateway ${response.gatewayId}")
        return creds
    }

    suspend fun testConnection(): Result<Unit> {
        val creds = credentialStore.get() ?: return Result.failure(Exception("Not registered"))
        return try {
            val response = apiProvider().heartbeat(
                "Gateway ${creds.gatewayId}:${creds.secret}",
                com.smsgateway.app.data.api.HeartbeatRequest(appVersion = BuildConfig.VERSION_NAME),
            )
            if (response.isSuccessful) Result.success(Unit)
            else Result.failure(Exception("HTTP ${response.code()}"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
