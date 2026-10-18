// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.domain

import com.smsgateway.app.data.api.GatewayApi
import com.smsgateway.app.data.api.JobDto
import com.smsgateway.app.data.api.JobResultRequest
import com.smsgateway.app.data.api.JobResultResponse
import com.smsgateway.app.data.local.CredentialStore
import com.smsgateway.app.data.local.GatewayCredentials
import com.smsgateway.app.data.local.JobRepository
import com.smsgateway.app.data.local.SentJobEntity
import com.smsgateway.app.sms.FakeSmsSender
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import java.time.Instant

class JobProcessorTest {

    private lateinit var api: GatewayApi
    private lateinit var credentialStore: CredentialStore
    private lateinit var jobRepository: JobRepository
    private lateinit var smsSender: FakeSmsSender
    private lateinit var processor: JobProcessor

    private val creds = GatewayCredentials(
        serverUrl = "https://example.com/",
        gatewayId = "gw-1",
        secret = "secret",
        gatewayName = "Test",
        subscriptionId = null,
    )

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        credentialStore = mockk()
        jobRepository = mockk(relaxed = true)
        smsSender = FakeSmsSender()
        processor = JobProcessor({ api }, credentialStore, jobRepository, smsSender)

        every { credentialStore.get() } returns creds
        coEvery { api.ackJob(any(), any()) } returns JobDto("j1", "+1", "hi", Instant.now().plusSeconds(300).toString(), "SENDING")
        coEvery { api.reportResult(any(), any(), any()) } returns JobResultResponse("j1", "SENT")
        coEvery { jobRepository.getJob(any()) } returns null
    }

    @Test
    fun processJob_sendsSmsAndReportsSuccess() = runTest {
        val job = JobDto(
            id = "j1",
            to = "+12025550100",
            message = "Hello",
            expiresAt = Instant.now().plusSeconds(300).toString(),
            status = "ASSIGNED",
        )
        processor.processJob(job, null)
        coVerify {
            api.reportResult(any(), "j1", JobResultRequest(success = true, deliveryStatus = "SUBMITTED"))
        }
        assert(smsSender.sentMessages.size == 1)
    }

    @Test
    fun processJob_skipsExpiredJob() = runTest {
        val job = JobDto(
            id = "j2",
            to = "+12025550100",
            message = "Expired",
            expiresAt = Instant.now().minusSeconds(60).toString(),
            status = "ASSIGNED",
        )
        processor.processJob(job, null)
        coVerify(exactly = 0) { api.ackJob(any(), any()) }
        assert(smsSender.sentMessages.isEmpty())
    }

    @Test
    fun processJob_reportsFailureOnSmsError() = runTest {
        smsSender.shouldFail = true
        val job = JobDto(
            id = "j3",
            to = "+12025550100",
            message = "Fail",
            expiresAt = Instant.now().plusSeconds(300).toString(),
            status = "ASSIGNED",
        )
        processor.processJob(job, null)
        coVerify {
            api.reportResult(
                any(),
                "j3",
                match { !it.success && it.errorCode == "FAKE_FAILURE" },
            )
        }
    }

    @Test
    fun processJob_doesNotSendWhenAcknowledgementFails() = runTest {
        coEvery { api.ackJob(any(), "j-ack-fail") } throws RuntimeException("server unavailable")

        processor.processJob(
            JobDto(
                id = "j-ack-fail",
                to = "+12025550100",
                message = "Do not send",
                expiresAt = Instant.now().plusSeconds(300).toString(),
                status = "ASSIGNED",
            ),
            null,
        )

        assert(smsSender.sentMessages.isEmpty())
        coVerify(exactly = 0) {
            api.reportResult(any(), "j-ack-fail", any())
        }
    }

    @Test
    fun processJob_doesNotSendAgainWhenLocalSuccessWasRecorded() = runTest {
        coEvery { jobRepository.getJob("j4") } returns SentJobEntity(
            jobId = "j4",
            toNumber = "+12025550100",
            bodyHash = "hash",
            success = true,
            errorCode = null,
            errorMessage = null,
            reported = false,
            createdAt = 1L,
        )

        processor.processJob(
            JobDto(
                id = "j4",
                to = "+12025550100",
                message = "Already sent",
                expiresAt = Instant.now().plusSeconds(300).toString(),
                status = "ASSIGNED",
            ),
            null,
        )

        coVerify(exactly = 0) { api.ackJob(any(), any()) }
        assert(smsSender.sentMessages.isEmpty())
        coVerify {
            api.reportResult(any(), "j4", JobResultRequest(success = true, deliveryStatus = "SUBMITTED"))
        }
    }

    @Test
    fun processJob_keepsResultPendingWhenReportingFails() = runTest {
        coEvery { api.reportResult(any(), any(), any()) } throws RuntimeException("network unavailable")

        processor.processJob(
            JobDto(
                id = "j5",
                to = "+12025550100",
                message = "Report later",
                expiresAt = Instant.now().plusSeconds(300).toString(),
                status = "ASSIGNED",
            ),
            null,
        )

        coVerify {
            jobRepository.savePendingResult(
                "j5",
                "+12025550100",
                any(),
                true,
                null,
                null,
                "SUBMITTED",
            )
        }
        coVerify(exactly = 0) { jobRepository.markReported("j5") }
        assert(smsSender.sentMessages.size == 1)
    }

    @Test
    fun replayUnreportedResults_reportsAndMarksEachPendingResult() = runTest {
        coEvery { jobRepository.getUnreportedJobs() } returns listOf(
            SentJobEntity(
                jobId = "j6",
                toNumber = "+12025550100",
                bodyHash = "hash",
                success = false,
                errorCode = "SEND_FAILED",
                errorMessage = "carrier rejected",
                reported = false,
                createdAt = 1L,
            ),
        )

        processor.replayUnreportedResults()

        coVerify {
            api.reportResult(
                any(),
                "j6",
                JobResultRequest(
                    success = false,
                    deliveryStatus = "DELIVERY_FAILED",
                    errorCode = "SEND_FAILED",
                    errorMessage = "carrier rejected",
                ),
            )
        }
        coVerify { jobRepository.markReported("j6") }
    }
}
