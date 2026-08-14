// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [SentJobEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class GatewayDatabase : RoomDatabase() {
    abstract fun sentJobDao(): SentJobDao
}
