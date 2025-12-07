package com.example.sen66widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import android.os.SystemClock
import android.widget.RemoteViews
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

class ChartWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        scheduleUpdate(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        cancelUpdate(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == AppWidgetManager.ACTION_APPWIDGET_UPDATE ||
            intent.action == Intent.ACTION_USER_PRESENT ||
            intent.action == ACTION_AUTO_UPDATE) {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val ids = appWidgetManager.getAppWidgetIds(ComponentName(context, ChartWidgetProvider::class.java))
            onUpdate(context, appWidgetManager, ids)
        }
    }

    companion object {
        private const val ACTION_AUTO_UPDATE = "com.example.sen66widget.CHART_ACTION_AUTO_UPDATE"

        fun updateAllWidgets(context: Context) {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val ids = appWidgetManager.getAppWidgetIds(ComponentName(context, ChartWidgetProvider::class.java))
            val intent = Intent(context, ChartWidgetProvider::class.java)
            intent.action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            context.sendBroadcast(intent)
            
            scheduleUpdate(context)
        }

        private fun scheduleUpdate(context: Context) {
            val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
            val intervalMinutes = prefs.getInt(MainActivity.PREF_UPDATE_INTERVAL, 5)
            val intervalMillis = intervalMinutes * 60 * 1000L

            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, ChartWidgetProvider::class.java).apply {
                action = ACTION_AUTO_UPDATE
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            alarmManager.cancel(pendingIntent)
            
            val triggerTime = SystemClock.elapsedRealtime() + intervalMillis
            alarmManager.setRepeating(
                AlarmManager.ELAPSED_REALTIME,
                triggerTime,
                intervalMillis,
                pendingIntent
            )
        }

        private fun cancelUpdate(context: Context) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, ChartWidgetProvider::class.java).apply {
                action = ACTION_AUTO_UPDATE
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            alarmManager.cancel(pendingIntent)
        }

        fun updateAppWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int
        ) {
            val views = RemoteViews(context.packageName, R.layout.chart_widget_layout)
            views.setTextViewText(R.id.chart_widget_title, "Loading...")
            appWidgetManager.updateAppWidget(appWidgetId, views)

            CoroutineScope(Dispatchers.IO).launch {
                val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
                val hours = prefs.getInt(MainActivity.PREF_CHART_HISTORY_HOURS, 24)
                
                val history = InfluxRepository.fetchHistoryData(context, hours)
                
                // Process data: compute IAQ score for each point
                val points = history.map { item ->
                    val result = IaqCalculator.computeDominantIndex(item.fields)
                    val score = if (result.score.isNaN()) -1f else result.score
                    Pair(item.time, score)
                }

                val bitmap = drawChart(points, 400, 200) // Fixed size for now, or dynamic?

                // Find dominant index of the latest entry
                val latestItem = history.maxByOrNull { it.time }
                val latestLabel = if (latestItem != null) {
                    IaqCalculator.computeDominantIndex(latestItem.fields).label
                } else {
                    "--"
                }

                withContext(Dispatchers.Main) {
                    val finalViews = RemoteViews(context.packageName, R.layout.chart_widget_layout)
                    finalViews.setTextViewText(R.id.chart_widget_title, "IAQ History (${hours}h)")
                    finalViews.setTextViewText(R.id.chart_widget_label, latestLabel)
                    finalViews.setImageViewBitmap(R.id.chart_widget_image, bitmap)

                    val intent = Intent(context, ChartWidgetProvider::class.java)
                    intent.action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                    val pendingIntent = PendingIntent.getBroadcast(
                        context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                    finalViews.setOnClickPendingIntent(R.id.chart_widget_image, pendingIntent)

                    appWidgetManager.updateAppWidget(appWidgetId, finalViews)
                }
            }
        }

        private fun drawChart(data: List<Pair<Long, Float>>, width: Int, height: Int): Bitmap {
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            
            // Padding
            val paddingStart = 10f
            val paddingEnd = 60f // More space for Y-axis labels on the right
            val paddingTop = 20f
            val paddingBottom = 40f 
            
            val chartWidth = width - paddingStart - paddingEnd
            val chartHeight = height - paddingTop - paddingBottom
            
            if (data.isEmpty()) return bitmap

            // Calculate Min/Max for dynamic scaling
            var minVal = data.minOf { it.second }
            var maxVal = data.maxOf { it.second }
            
            // Add some buffer to min/max so the line doesn't touch the edges exactly
            // unless it's a flat line
            if (maxVal == minVal) {
                minVal -= 5f
                maxVal += 5f
            } else {
                val range = maxVal - minVal
                minVal -= range * 0.1f
                maxVal += range * 0.1f
            }
            
            // Clamp min to 0 if it goes below (IAQ can't be negative)
            // But max can go above 100 theoretically if we change calc, but currently clamped to 100.
            // Let's allow zooming in on 20-30 range.
            minVal = minVal.coerceAtLeast(0f)
            
            val range = maxVal - minVal
            val scaleY = if (range == 0f) 1f else chartHeight / range

            // Helper to map Value -> Y coordinate
            fun getY(value: Float): Float {
                return height - paddingBottom - ((value - minVal) * scaleY)
            }

            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 6f
            paint.strokeCap = Paint.Cap.ROUND
            paint.strokeJoin = Paint.Join.ROUND
            
            // Dynamic Gradient: Map Colors to Absolute Scores
            // We want to keep it Green longer.
            // 0-40: Green
            // 40-60: Transition to Yellow
            // 60-80: Transition to Red
            // 80-100: Red
            
            val yScore0 = getY(0f)
            val yScore40 = getY(40f)
            val yScore60 = getY(60f)
            val yScore80 = getY(80f)
            val yScore100 = getY(100f)
            
            val gradient = LinearGradient(
                0f, yScore0, 
                0f, yScore100,
                intArrayOf(
                    Color.GREEN, 
                    Color.GREEN, 
                    Color.YELLOW, 
                    Color.parseColor("#FFA500"), // Orange
                    Color.RED
                ),
                floatArrayOf(
                    0f, 
                    (yScore40 - yScore0) / (yScore100 - yScore0), // Position of 40 relative to 0-100 range
                    (yScore60 - yScore0) / (yScore100 - yScore0), // Position of 60
                    (yScore80 - yScore0) / (yScore100 - yScore0), // Position of 80
                    1f
                ),
                Shader.TileMode.CLAMP
            )
            paint.shader = gradient
            
            val path = Path()
            val stepX = chartWidth / (data.size - 1).coerceAtLeast(1)
            
            var started = false
            
            for (i in data.indices) {
                val valY = data[i].second
                if (valY < 0) {
                    started = false
                    continue
                }
                
                val x = paddingStart + i * stepX
                val y = getY(valY)
                
                if (!started) {
                    path.moveTo(x, y)
                    started = true
                } else {
                    path.lineTo(x, y)
                }
            }
            
            // Draw shadow/glow
            val shadowPaint = Paint(paint)
            shadowPaint.shader = null
            shadowPaint.color = Color.parseColor("#40FFFFFF") // Lighter shadow
            shadowPaint.strokeWidth = 10f
            canvas.drawPath(path, shadowPaint)

            canvas.drawPath(path, paint)
            
            // Draw Labels & Grid
            val textPaint = Paint(Paint.ANTI_ALIAS_FLAG)
            textPaint.color = Color.LTGRAY
            textPaint.textSize = 24f
            textPaint.textAlign = Paint.Align.CENTER
            
            // X-Axis (Time)
            val sdf = SimpleDateFormat("HH:mm", Locale.getDefault())
            val labelIntervalPx = 100f
            val labelStep = (labelIntervalPx / stepX).roundToInt().coerceAtLeast(1)
            
            for (i in data.indices step labelStep) {
                val time = data[i].first
                val x = paddingStart + i * stepX
                val y = height - 5f
                canvas.drawText(sdf.format(Date(time)), x, y, textPaint)
            }
            
            // Y-Axis (Min/Max)
            textPaint.textAlign = Paint.Align.LEFT
            val labelX = width - paddingEnd + 5f
            
            // Max Label
            canvas.drawText(String.format("%.0f", maxVal), labelX, paddingTop + 10f, textPaint)
            // Min Label
            canvas.drawText(String.format("%.0f", minVal), labelX, height - paddingBottom, textPaint)
            
            // Grid lines for Min/Max
            val gridPaint = Paint()
            gridPaint.color = Color.parseColor("#40FFFFFF")
            gridPaint.strokeWidth = 1f
            gridPaint.pathEffect = android.graphics.DashPathEffect(floatArrayOf(5f, 5f), 0f)
            
            // Top grid line (Max)
            val yMax = getY(maxVal)
            canvas.drawLine(paddingStart, yMax, width - paddingEnd, yMax, gridPaint)
            
            // Bottom grid line (Min)
            val yMin = getY(minVal)
            canvas.drawLine(paddingStart, yMin, width - paddingEnd, yMin, gridPaint)

            return bitmap
        }
    }
}
