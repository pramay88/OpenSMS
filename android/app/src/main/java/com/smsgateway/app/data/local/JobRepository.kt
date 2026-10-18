// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.data.local

interface JobRepository {
    suspend fun savePendingResult(
        jobId: String,
        toNumber: String,
        bodyHash: String,
        success: Boolean,
        errorCode: String? = null,
        errorMessage: String? = null,
        deliveryStatus: String? = null,
    )

    suspend fun getUnreportedJobs(): List<SentJobEntity>
    suspend fun markReported(jobId: String)
    suspend fun getJob(jobId: String): SentJobEntity?
    suspend fun cleanupOldReported(olderThanMs: Long)
}

class RoomJobRepository(
    private val dao: SentJobDao,
) : JobRepository {
    override suspend fun savePendingResult(
        jobId: String,
        toNumber: String,
        bodyHash: String,
        success: Boolean,
        errorCode: String?,
        errorMessage: String?,
        deliveryStatus: String?,
    ) {
        dao.upsert(
            SentJobEntity(
                jobId = jobId,
                toNumber = toNumber,
                bodyHash = bodyHash,
                success = success,
                errorCode = errorCode,
                errorMessage = errorMessage,
                reported = false,
                createdAt = System.currentTimeMillis(),
                deliveryStatus = deliveryStatus,
            ),
        )
    }

    override suspend fun getUnreportedJobs(): List<SentJobEntity> = dao.getUnreported()

    override suspend fun markReported(jobId: String) {
        dao.markReported(jobId)
    }

    override suspend fun getJob(jobId: String): SentJobEntity? = dao.getById(jobId)

    override suspend fun cleanupOldReported(olderThanMs: Long) {
        dao.deleteOldReported(System.currentTimeMillis() - olderThanMs)
    }
}
