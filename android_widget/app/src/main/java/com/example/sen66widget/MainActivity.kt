package com.example.sen66widget

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.widget.Button
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.textfield.TextInputEditText

class MainActivity : AppCompatActivity() {

    private lateinit var editUrl: TextInputEditText
    private lateinit var editOrg: TextInputEditText
    private lateinit var editBucket: TextInputEditText
    private lateinit var editToken: TextInputEditText
    private lateinit var editInterval: TextInputEditText
    private lateinit var editMaxAge: TextInputEditText
    private lateinit var editChartHistoryHours: TextInputEditText
    private lateinit var editTrendInterval: TextInputEditText
    private lateinit var btnSave: Button

    private lateinit var prefs: SharedPreferences

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        editUrl = findViewById(R.id.edit_influx_url)
        editOrg = findViewById(R.id.edit_influx_org)
        editBucket = findViewById(R.id.edit_influx_bucket)
        editToken = findViewById(R.id.edit_influx_token)
        editInterval = findViewById(R.id.edit_update_interval)
        editMaxAge = findViewById(R.id.edit_max_data_age)
        editChartHistoryHours = findViewById(R.id.edit_chart_history_hours)
        editTrendInterval = findViewById(R.id.edit_trend_interval)
        btnSave = findViewById(R.id.btn_save)

        loadSettings()

        btnSave.setOnClickListener {
            saveSettings()
        }
    }

    private fun loadSettings() {
        editUrl.setText(prefs.getString(PREF_INFLUX_URL, ""))
        editOrg.setText(prefs.getString(PREF_INFLUX_ORG, ""))
        editBucket.setText(prefs.getString(PREF_INFLUX_BUCKET, ""))
        editToken.setText(prefs.getString(PREF_INFLUX_TOKEN, ""))
        editInterval.setText(prefs.getInt(PREF_UPDATE_INTERVAL, 5).toString())
        editMaxAge.setText(prefs.getInt(PREF_MAX_DATA_AGE, 360).toString())
        editChartHistoryHours.setText(prefs.getInt(PREF_CHART_HISTORY_HOURS, 24).toString())
        editTrendInterval.setText(prefs.getInt(PREF_TREND_INTERVAL, 10).toString())
    }

    private fun saveSettings() {
        val url = editUrl.text.toString().trim()
        val org = editOrg.text.toString().trim()
        val bucket = editBucket.text.toString().trim()
        val token = editToken.text.toString().trim()
        val intervalStr = editInterval.text.toString().trim()
        val maxAgeStr = editMaxAge.text.toString().trim()
        val chartHistoryHoursStr = editChartHistoryHours.text.toString().trim()
        val trendIntervalStr = editTrendInterval.text.toString().trim()

        if (url.isEmpty() || org.isEmpty() || bucket.isEmpty() || token.isEmpty() || intervalStr.isEmpty() || maxAgeStr.isEmpty() || chartHistoryHoursStr.isEmpty() || trendIntervalStr.isEmpty()) {
            Toast.makeText(this, "Please fill in all fields", Toast.LENGTH_SHORT).show()
            return
        }

        val interval = intervalStr.toIntOrNull()
        val maxAge = maxAgeStr.toIntOrNull()
        val chartHistoryHours = chartHistoryHoursStr.toIntOrNull()
        val trendInterval = trendIntervalStr.toIntOrNull()

        if (interval == null || interval <= 0) {
            Toast.makeText(this, "Invalid interval", Toast.LENGTH_SHORT).show()
            return
        }

        if (maxAge == null || maxAge <= 0) {
            Toast.makeText(this, "Invalid max age", Toast.LENGTH_SHORT).show()
            return
        }

        if (chartHistoryHours == null || chartHistoryHours <= 0) {
            Toast.makeText(this, "Invalid chart history hours", Toast.LENGTH_SHORT).show()
            return
        }

        if (trendInterval == null || trendInterval <= 0) {
            Toast.makeText(this, "Invalid trend interval", Toast.LENGTH_SHORT).show()
            return
        }

        prefs.edit().apply {
            putString(PREF_INFLUX_URL, url)
            putString(PREF_INFLUX_ORG, org)
            putString(PREF_INFLUX_BUCKET, bucket)
            putString(PREF_INFLUX_TOKEN, token)
            putInt(PREF_UPDATE_INTERVAL, interval)
            putInt(PREF_MAX_DATA_AGE, maxAge)
            putInt(PREF_CHART_HISTORY_HOURS, chartHistoryHours)
            putInt(PREF_TREND_INTERVAL, trendInterval)
            apply()
        }

        Toast.makeText(this, "Settings saved", Toast.LENGTH_SHORT).show()
        
        // Trigger widget update to apply new settings immediately
        WidgetProvider.updateAllWidgets(this)
        ChartWidgetProvider.updateAllWidgets(this)
        TrendWidgetProvider.updateAllWidgets(this)
    }

    companion object {
        const val PREFS_NAME = "Sen66WidgetPrefs"
        const val PREF_INFLUX_URL = "influx_url"
        const val PREF_INFLUX_ORG = "influx_org"
        const val PREF_INFLUX_BUCKET = "influx_bucket"
        const val PREF_INFLUX_TOKEN = "influx_token"
        const val PREF_UPDATE_INTERVAL = "update_interval"
        const val PREF_MAX_DATA_AGE = "max_data_age"
        const val PREF_CHART_HISTORY_HOURS = "chart_history_hours"
        const val PREF_TREND_INTERVAL = "trend_interval"
    }
}
