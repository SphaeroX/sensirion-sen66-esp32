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
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import kotlin.math.max

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
    data class HistoryItem(
        val time: Long,
        val fields: IaqCalculator.LatestFields
    )

    fun fetchHistoryData(context: Context, hours: Int): List<HistoryItem> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val influxUrl = prefs.getString(PREF_INFLUX_URL, "") ?: ""
        val influxOrg = prefs.getString(PREF_INFLUX_ORG, "") ?: ""
        val influxBucket = prefs.getString(PREF_INFLUX_BUCKET, "") ?: ""
        val influxToken = prefs.getString(PREF_INFLUX_TOKEN, "") ?: ""

        if (influxUrl.isEmpty() || influxOrg.isEmpty() || influxBucket.isEmpty() || influxToken.isEmpty()) {
            return emptyList()
        }

        // Calculate window to get approx 50 points
        val windowMinutes = max(1, (hours * 60) / 50)

        val fluxQuery = """
            from(bucket: "$influxBucket")
              |> range(start: -${hours}h)
              |> filter(fn: (r) => r["_measurement"] == "environment")
              |> filter(fn: (r) => r["_field"] == "pm2_5" or r["_field"] == "pm10" or r["_field"] == "co2" or r["_field"] == "voc" or r["_field"] == "nox")
              |> aggregateWindow(every: ${windowMinutes}m, fn: mean, createEmpty: false)
              |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
              |> keep(columns: ["_time", "pm2_5", "pm10", "co2", "voc", "nox"])
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
                if (!response.isSuccessful) return emptyList()
                val body = response.body?.string() ?: return emptyList()
                return parseHistoryResponse(body)
            }
        } catch (e: IOException) {
            e.printStackTrace()
            return emptyList()
        }
    }

    private fun parseHistoryResponse(csv: String): List<HistoryItem> {
        val items = mutableListOf<HistoryItem>()
        val lines = csv.lines()
        
        // Header parsing
        var timeIdx = -1
        var pm25Idx = -1
        var pm10Idx = -1
        var co2Idx = -1
        var vocIdx = -1
        var noxIdx = -1

        // ISO 8601 parser
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")

        for (line in lines) {
            if (line.isBlank() || line.startsWith("#")) continue
            
            val cols = line.split(",")
            
            if (cols.contains("_time")) {
                timeIdx = cols.indexOf("_time")
                pm25Idx = cols.indexOf("pm2_5")
                pm10Idx = cols.indexOf("pm10")
                co2Idx = cols.indexOf("co2")
                vocIdx = cols.indexOf("voc")
                noxIdx = cols.indexOf("nox")
                continue
            }

            if (timeIdx != -1 && cols.size > timeIdx) {
                val timeStr = cols[timeIdx]
                // Handle fractional seconds if present
                val cleanTimeStr = if (timeStr.contains(".")) timeStr.substringBefore(".") else timeStr
                // Handle Z if present (though SimpleDateFormat might need 'Z' in pattern or we strip it)
                // Influx usually returns 2023-10-27T10:00:00Z. 
                // Let's try to parse robustly.
                
                val time = try {
                    // Remove Z if present for simple parsing, or assume UTC
                    val t = cleanTimeStr.replace("Z", "")
                    sdf.parse(t)?.time ?: 0L
                } catch (e: Exception) {
                    0L
                }

                if (time == 0L) continue

                val fields = IaqCalculator.LatestFields()
                if (pm25Idx != -1 && cols.size > pm25Idx) fields.pm25 = cols[pm25Idx].toFloatOrNull() ?: Float.NaN
                if (pm10Idx != -1 && cols.size > pm10Idx) fields.pm10 = cols[pm10Idx].toFloatOrNull() ?: Float.NaN
                if (co2Idx != -1 && cols.size > co2Idx) fields.co2 = cols[co2Idx].toFloatOrNull() ?: Float.NaN
                if (vocIdx != -1 && cols.size > vocIdx) fields.voc = cols[vocIdx].toFloatOrNull() ?: Float.NaN
                if (noxIdx != -1 && cols.size > noxIdx) fields.nox = cols[noxIdx].toFloatOrNull() ?: Float.NaN

                items.add(HistoryItem(time, fields))
            }
        }
        return items
    }
    fun fetchTrendData(context: Context, minutes: Int): Map<String, Float> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val influxUrl = prefs.getString(PREF_INFLUX_URL, "") ?: ""
        val influxOrg = prefs.getString(PREF_INFLUX_ORG, "") ?: ""
        val influxBucket = prefs.getString(PREF_INFLUX_BUCKET, "") ?: ""
        val influxToken = prefs.getString(PREF_INFLUX_TOKEN, "") ?: ""

        if (influxUrl.isEmpty() || influxOrg.isEmpty() || influxBucket.isEmpty() || influxToken.isEmpty()) {
            return emptyMap()
        }

        // Query: Get first and last value in the time window for each field
        val fluxQuery = """
            data = from(bucket: "$influxBucket")
              |> range(start: -${minutes}m)
              |> filter(fn: (r) => r["_measurement"] == "environment")
              |> filter(fn: (r) => r["_field"] == "pm2_5" or r["_field"] == "pm10" or r["_field"] == "co2" or r["_field"] == "voc" or r["_field"] == "nox")
            
            first = data |> first() |> set(key: "_type", value: "first")
            last = data |> last() |> set(key: "_type", value: "last")
            
            union(tables: [first, last])
              |> keep(columns: ["_field", "_value", "_type"])
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
                if (!response.isSuccessful) return emptyMap()
                val body = response.body?.string() ?: return emptyMap()
                return parseTrendResponse(body)
            }
        } catch (e: IOException) {
            e.printStackTrace()
            return emptyMap()
        }
    }

    private fun parseTrendResponse(csv: String): Map<String, Float> {
        val firstValues = mutableMapOf<String, Float>()
        val lastValues = mutableMapOf<String, Float>()
        
        val lines = csv.lines()
        var fieldIdx = -1
        var valueIdx = -1
        var typeIdx = -1

        for (line in lines) {
            if (line.isBlank() || line.startsWith("#")) continue
            
            val cols = line.split(",")
            if (cols.contains("_field") && cols.contains("_value") && cols.contains("_type")) {
                fieldIdx = cols.indexOf("_field")
                valueIdx = cols.indexOf("_value")
                typeIdx = cols.indexOf("_type")
                continue
            }

            if (fieldIdx != -1 && valueIdx != -1 && typeIdx != -1 && cols.size > max(max(fieldIdx, valueIdx), typeIdx)) {
                val field = cols[fieldIdx]
                val value = cols[valueIdx].toFloatOrNull() ?: continue
                val type = cols[typeIdx]
                
                if (type == "first") {
                    firstValues[field] = value
                } else if (type == "last") {
                    lastValues[field] = value
                }
            }
        }

        val trends = mutableMapOf<String, Float>()
        for ((field, last) in lastValues) {
            val first = firstValues[field] ?: continue
            trends[field] = last - first
        }
        return trends
    }
}
