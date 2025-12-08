package com.example.sen66widget

import android.content.Context
import android.util.Log
import com.example.sen66widget.MainActivity.Companion.PREFS_NAME
import com.example.sen66widget.MainActivity.Companion.PREF_INFLUX_BUCKET
import com.example.sen66widget.MainActivity.Companion.PREF_INFLUX_ORG
import com.example.sen66widget.MainActivity.Companion.PREF_INFLUX_TOKEN
import com.example.sen66widget.MainActivity.Companion.PREF_INFLUX_URL
import com.example.sen66widget.MainActivity.Companion.PREF_MAX_DATA_AGE
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit
import kotlin.math.max

object InfluxRepository {

    private const val TAG = "InfluxRepository"
    private const val CACHE_DURATION_MS = 5 * 60 * 1000L // 5 Minutes
    private const val TREND_CACHE_DURATION_MS = 10 * 60 * 1000L // 10 Minutes
    private const val HISTORY_CACHE_DURATION_MS = 15 * 60 * 1000L // 15 Minutes

    private const val KEY_CACHED_LATEST_FIELDS = "cached_last_fields"

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()
    private val mutex = Mutex()

    // In-Memory Caches
    private var cachedLatestFields: IaqCalculator.LatestFields? = null
    private var lastFetchTime = 0L

    private var cachedTrendData: Map<String, Float>? = null
    private var lastTrendFetchTime = 0L

    private var cachedHistoryData: List<HistoryItem>? = null
    private var lastHistoryFetchTime = 0L

    // --- Public API ---

    suspend fun getLatestFieldsSuspend(context: Context): IaqCalculator.LatestFields? {
        return mutex.withLock {
            val now = System.currentTimeMillis()
            
            // 1. Check Memory Cache
            if (cachedLatestFields != null && (now - lastFetchTime) < CACHE_DURATION_MS) {
                Log.d(TAG, "getLatestFields: Returning MEMORY CACHE")
                return@withLock cachedLatestFields
            }

            // 2. Try to load from Disk if Memory is empty (e.g. app restart)
            if (cachedLatestFields == null) {
                val diskCache = loadLatestFieldsFromDisk(context)
                if (diskCache != null) {
                    // Check age of disk cache? For now, we use it to show *mostly* fresh data immediately
                    // But if it's too old, we might want to fetch. 
                    // Let's assume on cold start we trust disk cache first, but trigger background refresh if needed?
                    // Simpler: Just use it as fallback if network fails, OR use it if valid.
                    // Implementation: If disk cache exists, load into memory.
                    cachedLatestFields = diskCache
                    // We don't know the exact fetch time of disk cache, so we force a refresh if we want strictness.
                    // But to be user friendly:
                    Log.d(TAG, "getLatestFields: Loaded from DISK CACHE")
                }
            }

            // 3. Fetch from Network
            Log.d(TAG, "getLatestFields: Fetching from NETWORK...")
            val fetched = fetchLatestFieldsInternal(context)
            if (fetched != null) {
                cachedLatestFields = fetched
                lastFetchTime = now
                saveLatestFieldsToDisk(context, fetched)
                Log.d(TAG, "getLatestFields: Network success & cached")
                return@withLock fetched
            } else {
                Log.e(TAG, "getLatestFields: Network failed")
                // Return cached version if redundant fetch failed
                return@withLock cachedLatestFields
            }
        }
    }

    suspend fun getTrendDataSuspend(context: Context, minutes: Int): Map<String, Float> {
        return mutex.withLock {
            val now = System.currentTimeMillis()
            if (cachedTrendData != null && (now - lastTrendFetchTime) < TREND_CACHE_DURATION_MS) {
                Log.d(TAG, "getTrendData: Returning MEMORY CACHE")
                return@withLock cachedTrendData!!
            }

            Log.d(TAG, "getTrendData: Fetching from NETWORK")
            val fetched = fetchTrendDataInternal(context, minutes)
            if (fetched.isNotEmpty()) {
                cachedTrendData = fetched
                lastTrendFetchTime = now
            }
            return@withLock fetched
        }
    }

    suspend fun getHistoryDataSuspend(context: Context, hours: Int): List<HistoryItem> {
        return mutex.withLock {
            val now = System.currentTimeMillis()
            if (cachedHistoryData != null && cachedHistoryData!!.isNotEmpty() && (now - lastHistoryFetchTime) < HISTORY_CACHE_DURATION_MS) {
                Log.d(TAG, "getHistoryData: Returning MEMORY CACHE")
                return@withLock cachedHistoryData!!
            }
            
            Log.d(TAG, "getHistoryData: Fetching from NETWORK")
            val fetched = fetchHistoryDataInternal(context, hours)
            if (fetched.isNotEmpty()) {
                cachedHistoryData = fetched
                lastHistoryFetchTime = now
            }
            return@withLock fetched
        }
    }

    // Adapt legacy calls if needed (though we plan to refactor widgets to use suspend)
    // For now, we can keep the old methods but make them call the internal logic directly 
    // OR we remove them and force refactor. The plan says "Replace direct calls".
    // I will keep private internal methods for the actual logic.

    // --- Internal Implementation ---

    private suspend fun fetchLatestFieldsInternal(context: Context): IaqCalculator.LatestFields? {
        return withContext(Dispatchers.IO) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val influxUrl = prefs.getString(PREF_INFLUX_URL, "") ?: ""
            val influxOrg = prefs.getString(PREF_INFLUX_ORG, "") ?: ""
            val influxBucket = prefs.getString(PREF_INFLUX_BUCKET, "") ?: ""
            val influxToken = prefs.getString(PREF_INFLUX_TOKEN, "") ?: ""
            val maxDataAge = prefs.getInt(PREF_MAX_DATA_AGE, 360) 

            if (influxUrl.isEmpty() || influxOrg.isEmpty() || influxBucket.isEmpty() || influxToken.isEmpty()) {
                return@withContext null
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
                    if (!response.isSuccessful) return@withContext null
                    val body = response.body?.string() ?: return@withContext null
                    return@withContext parseFluxResponse(body)
                }
            } catch (e: IOException) {
                e.printStackTrace()
                return@withContext null
            }
        }
    }

    private fun parseFluxResponse(csv: String): IaqCalculator.LatestFields {
        val fields = IaqCalculator.LatestFields()
        val lines = csv.lines()
        
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

    private suspend fun fetchHistoryDataInternal(context: Context, hours: Int): List<HistoryItem> {
        return withContext(Dispatchers.IO) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val influxUrl = prefs.getString(PREF_INFLUX_URL, "") ?: ""
            val influxOrg = prefs.getString(PREF_INFLUX_ORG, "") ?: ""
            val influxBucket = prefs.getString(PREF_INFLUX_BUCKET, "") ?: ""
            val influxToken = prefs.getString(PREF_INFLUX_TOKEN, "") ?: ""

            if (influxUrl.isEmpty() || influxOrg.isEmpty() || influxBucket.isEmpty() || influxToken.isEmpty()) {
                return@withContext emptyList()
            }

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
                    if (!response.isSuccessful) return@withContext emptyList()
                    val body = response.body?.string() ?: return@withContext emptyList()
                    return@withContext parseHistoryResponse(body)
                }
            } catch (e: IOException) {
                e.printStackTrace()
                return@withContext emptyList()
            }
        }
    }

    private fun parseHistoryResponse(csv: String): List<HistoryItem> {
        val items = mutableListOf<HistoryItem>()
        val lines = csv.lines()
        
        var timeIdx = -1
        var pm25Idx = -1
        var pm10Idx = -1
        var co2Idx = -1
        var vocIdx = -1
        var noxIdx = -1

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
                val cleanTimeStr = if (timeStr.contains(".")) timeStr.substringBefore(".") else timeStr
                
                val time = try {
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

    private suspend fun fetchTrendDataInternal(context: Context, minutes: Int): Map<String, Float> {
        return withContext(Dispatchers.IO) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val influxUrl = prefs.getString(PREF_INFLUX_URL, "") ?: ""
            val influxOrg = prefs.getString(PREF_INFLUX_ORG, "") ?: ""
            val influxBucket = prefs.getString(PREF_INFLUX_BUCKET, "") ?: ""
            val influxToken = prefs.getString(PREF_INFLUX_TOKEN, "") ?: ""

            if (influxUrl.isEmpty() || influxOrg.isEmpty() || influxBucket.isEmpty() || influxToken.isEmpty()) {
                return@withContext emptyMap()
            }

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
                    if (!response.isSuccessful) return@withContext emptyMap()
                    val body = response.body?.string() ?: return@withContext emptyMap()
                    return@withContext parseTrendResponse(body)
                }
            } catch (e: IOException) {
                e.printStackTrace()
                return@withContext emptyMap()
            }
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

    // --- Persistance Utils ---

    private fun saveLatestFieldsToDisk(context: Context, fields: IaqCalculator.LatestFields) {
        try {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val json = gson.toJson(fields)
            prefs.edit().putString(KEY_CACHED_LATEST_FIELDS, json).apply()
        } catch (e: Exception) {
            Log.e(TAG, "Error saving to disk", e)
        }
    }

    private fun loadLatestFieldsFromDisk(context: Context): IaqCalculator.LatestFields? {
        try {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val json = prefs.getString(KEY_CACHED_LATEST_FIELDS, null)
            if (json != null) {
                return gson.fromJson(json, IaqCalculator.LatestFields::class.java)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error loading from disk", e)
        }
        return null
    }
    
    // Compatibility methods if needed by other parts of the app that we haven't refactored yet.
    // However, we SHOULD refactor them.
    // But MainActivity might call this? Let's check. 
    // Just in case, we keep the original blocking methods as wrappers OR simply assume we fix all callers.
    // The previous analysis showed only Widgets using it heavily. MainActivity usually has its own VM or logic?
    // Let's check MainActivity later. For now, we provide the suspended APIs.
    
    // To allow Java-style or blocking calls if strictly needed (not recommended):
    fun fetchLatestFieldsBlocking(context: Context): IaqCalculator.LatestFields? {
         return kotlinx.coroutines.runBlocking { getLatestFieldsSuspend(context) }
    }
}
