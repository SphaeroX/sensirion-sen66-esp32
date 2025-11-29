package com.example.sen66widget

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

import android.content.Context
import com.example.sen66widget.MainActivity.Companion.PREFS_NAME
import com.example.sen66widget.MainActivity.Companion.PREF_INFLUX_URL
import com.example.sen66widget.MainActivity.Companion.PREF_INFLUX_ORG
import com.example.sen66widget.MainActivity.Companion.PREF_INFLUX_BUCKET
import com.example.sen66widget.MainActivity.Companion.PREF_INFLUX_TOKEN
import com.example.sen66widget.MainActivity.Companion.PREF_MAX_DATA_AGE

object InfluxRepository {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    fun fetchLatestFields(context: Context): IaqCalculator.LatestFields? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val influxUrl = prefs.getString(PREF_INFLUX_URL, "") ?: ""
        val influxOrg = prefs.getString(PREF_INFLUX_ORG, "") ?: ""
        val influxBucket = prefs.getString(PREF_INFLUX_BUCKET, "") ?: ""
        val influxToken = prefs.getString(PREF_INFLUX_TOKEN, "") ?: ""
        val maxDataAge = prefs.getInt(PREF_MAX_DATA_AGE, 360) // Default 6 hours

        if (influxUrl.isEmpty() || influxOrg.isEmpty() || influxBucket.isEmpty() || influxToken.isEmpty()) {
            return null
        }

        val fluxQuery = """
            from(bucket: "$influxBucket")
              |> range(start: -${maxDataAge}m)
              |> filter(fn: (r) => r["_measurement"] == "environment")
              |> filter(fn: (r) => r["_field"] == "pm2_5" or r["_field"] == "pm10" or r["_field"] == "co2" or r["_field"] == "voc" or r["_field"] == "nox")
              |> last()
              |> keep(columns: ["_field", "_value"])
        """.trimIndent()

        val request = Request.Builder()
            .url("$influxUrl/api/v2/query?org=$influxOrg")
            .addHeader("Authorization", "Token $influxToken")
            .addHeader("Accept", "application/csv")
            .addHeader("Content-Type", "application/vnd.flux")
            .post(fluxQuery.toRequestBody("application/vnd.flux".toMediaType()))
            .build()

        try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                val body = response.body?.string() ?: return null
                return parseFluxResponse(body)
            }
        } catch (e: IOException) {
            e.printStackTrace()
            return null
        }
    }

    private fun parseFluxResponse(csv: String): IaqCalculator.LatestFields {
        val fields = IaqCalculator.LatestFields()
        val lines = csv.lines()
        
        // Simple CSV parsing logic
        // Assuming standard Flux CSV output where columns are consistent or we find them by header
        // For robustness, we should find indices, but for this snippet we'll do a simple scan
        
        var fieldIdx = -1
        var valueIdx = -1

        for (line in lines) {
            if (line.isBlank() || line.startsWith("#")) continue
            
            val cols = line.split(",")
            if (cols.contains("_field") && cols.contains("_value")) {
                fieldIdx = cols.indexOf("_field")
                valueIdx = cols.indexOf("_value")
                continue
            }

            if (fieldIdx != -1 && valueIdx != -1 && cols.size > maxOf(fieldIdx, valueIdx)) {
                val field = cols[fieldIdx]
                val value = cols[valueIdx].toFloatOrNull() ?: continue
                
                when (field) {
                    "pm2_5" -> fields.pm25 = value
                    "pm10" -> fields.pm10 = value
                    "co2" -> fields.co2 = value
                    "voc" -> fields.voc = value
                    "nox" -> fields.nox = value
                }
            }
        }
        return fields
    }
}
