// SPDX-License-Identifier: Apache-2.0
package com.smsgateway.app.data.api

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path

interface GatewayApi {
    @POST("api/v1/gateways/register")
    suspend fun register(@Body request: RegisterRequest): RegisterResponse

    @POST("api/v1/gateways/heartbeat")
    suspend fun heartbeat(
        @Header("Authorization") authorization: String,
        @Body request: HeartbeatRequest,
    ): Response<Unit>

    @GET("api/v1/gateways/jobs")
    suspend fun getJobs(
        @Header("Authorization") authorization: String,
    ): JobsResponse

    @POST("api/v1/gateways/jobs/{jobId}/ack")
    suspend fun ackJob(
        @Header("Authorization") authorization: String,
        @Path("jobId") jobId: String,
    ): JobDto

    @POST("api/v1/gateways/jobs/{jobId}/result")
    suspend fun reportResult(
        @Header("Authorization") authorization: String,
        @Path("jobId") jobId: String,
        @Body request: JobResultRequest,
    ): JobResultResponse
}
