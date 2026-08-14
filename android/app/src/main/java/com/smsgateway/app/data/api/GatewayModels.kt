// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.data.api

import com.google.gson.annotations.SerializedName

data class RegisterRequest(
    val token: String,
    val name: String,
)

data class RegisterResponse(
    @SerializedName("gatewayId") val gatewayId: String,
    val secret: String,
)

data class HeartbeatRequest(
    val appVersion: String,
    val capabilities: String? = null,
    val simInfo: String? = null,
    val networkInfo: String? = null,
    val paused: Boolean = false,
)

data class JobDto(
    val id: String,
    val to: String,
    val message: String,
    val expiresAt: String,
    val status: String,
)

data class JobsResponse(
    val jobs: List<JobDto>,
)

data class JobResultRequest(
    val success: Boolean,
    val errorCode: String? = null,
    val errorMessage: String? = null,
)

data class JobResultResponse(
    val id: String,
    val status: String,
)

data class ApiErrorResponse(
    val error: ApiErrorBody?,
)

data class ApiErrorBody(
    val code: String,
    val message: String,
)
