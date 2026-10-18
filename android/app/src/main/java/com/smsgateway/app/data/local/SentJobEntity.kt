// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.data.local

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query

@Entity(tableName = "sent_jobs")
data class SentJobEntity(
    @PrimaryKey val jobId: String,
    val toNumber: String,
    val bodyHash: String,
    val success: Boolean,
    val errorCode: String?,
    val errorMessage: String?,
    val reported: Boolean,
    val createdAt: Long,
    val deliveryStatus: String? = null,
)

@Dao
interface SentJobDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(job: SentJobEntity)

    @Query("SELECT * FROM sent_jobs WHERE reported = 0 ORDER BY createdAt ASC")
    suspend fun getUnreported(): List<SentJobEntity>

    @Query("UPDATE sent_jobs SET reported = 1 WHERE jobId = :jobId")
    suspend fun markReported(jobId: String)

    @Query("SELECT * FROM sent_jobs WHERE jobId = :jobId LIMIT 1")
    suspend fun getById(jobId: String): SentJobEntity?

    @Query("DELETE FROM sent_jobs WHERE reported = 1 AND createdAt < :before")
    suspend fun deleteOldReported(before: Long)
}
