package com.example.sen66widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.app.AlarmManager
import android.os.SystemClock
import android.widget.RemoteViews
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

class WidgetProvider : AppWidgetProvider() {

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
            val ids = appWidgetManager.getAppWidgetIds(ComponentName(context, WidgetProvider::class.java))
            onUpdate(context, appWidgetManager, ids)
        }
    }

    companion object {
        private const val LED_RING_COUNT = 12
        private const val ACTION_AUTO_UPDATE = "com.example.sen66widget.ACTION_AUTO_UPDATE"

        fun updateAllWidgets(context: Context) {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val ids = appWidgetManager.getAppWidgetIds(ComponentName(context, WidgetProvider::class.java))
            val intent = Intent(context, WidgetProvider::class.java)
            intent.action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            context.sendBroadcast(intent)
            
            // Reschedule with new interval if needed
            scheduleUpdate(context)
        }

        private fun scheduleUpdate(context: Context) {
            val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
            val intervalMinutes = prefs.getInt(MainActivity.PREF_UPDATE_INTERVAL, 5)
            val intervalMillis = intervalMinutes * 60 * 1000L

            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, WidgetProvider::class.java).apply {
                action = ACTION_AUTO_UPDATE
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            // Cancel any existing alarm
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
            val intent = Intent(context, WidgetProvider::class.java).apply {
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
            // Show loading state
            val views = RemoteViews(context.packageName, R.layout.widget_layout)
            views.setTextViewText(R.id.widget_iaq_value, "...")
            appWidgetManager.updateAppWidget(appWidgetId, views)

            // Fetch data in background
            CoroutineScope(Dispatchers.IO).launch {
                val fields = InfluxRepository.getLatestFieldsSuspend(context)
                val result = if (fields != null) IaqCalculator.computeDominantIndex(fields) else IaqCalculator.IaqResult(Float.NaN, "--")

                withContext(Dispatchers.Main) {
                    val finalViews = RemoteViews(context.packageName, R.layout.widget_layout)
                    
                    if (result.score.isNaN()) {
                        finalViews.setTextViewText(R.id.widget_iaq_value, "--")
                        finalViews.setTextViewText(R.id.widget_iaq_label, "IAQ")
                        // Draw empty or error ring
                        finalViews.setImageViewBitmap(R.id.widget_led_ring, drawRing(context, 0))
                    } else {
                        finalViews.setTextViewText(R.id.widget_iaq_value, result.score.roundToInt().toString())
                        finalViews.setTextViewText(R.id.widget_iaq_label, result.label)
                        
                        // Calculate active LEDs
                        val activeCount = ((result.score.coerceIn(0f, 100f) / 100f) * LED_RING_COUNT).roundToInt()
                        finalViews.setImageViewBitmap(R.id.widget_led_ring, drawRing(context, activeCount))
                    }

                    // Setup click intent to refresh
                    val intent = Intent(context, WidgetProvider::class.java)
                    intent.action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                    val pendingIntent = PendingIntent.getBroadcast(
                        context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                    finalViews.setOnClickPendingIntent(R.id.widget_led_ring, pendingIntent)

                    appWidgetManager.updateAppWidget(appWidgetId, finalViews)
                }
            }
        }

        private fun drawRing(context: Context, activeCount: Int): Bitmap {
            val size = 300 // Bitmap size
            val center = size / 2f
            val radius = size * 0.4f
            val dotRadius = size * 0.04f

            val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            paint.style = Paint.Style.FILL

            for (i in 0 until LED_RING_COUNT) {
                // Angle logic: 0 is usually top or right. 
                // In main.cpp, it's just index 0..11. Let's assume 0 is top and goes clockwise.
                // -90 degrees to start at top
                val angleDeg = (i * 360f / LED_RING_COUNT) - 90
                val angleRad = Math.toRadians(angleDeg.toDouble())

                val x = center + radius * cos(angleRad).toFloat()
                val y = center + radius * sin(angleRad).toFloat()

                // Color logic
                if (i < activeCount) {
                    paint.color = getColorForSlot(i)
                    // Brightness logic simplified: just full color
                } else {
                    // Dimmed/Off color
                    paint.color = Color.parseColor("#333333") 
                }

                canvas.drawCircle(x, y, dotRadius, paint)
            }
            return bitmap
        }

        private fun getColorForSlot(idx: Int): Int {
            // 0-3 Green, 4-7 Orange, 8-11 Red
            return when {
                idx < 4 -> Color.rgb(0, 150, 0)
                idx < 8 -> Color.rgb(180, 90, 0)
                else -> Color.rgb(150, 0, 0)
            }
        }
    }
}
