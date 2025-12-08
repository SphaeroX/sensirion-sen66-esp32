package com.example.sen66widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.example.sen66widget.MainActivity.Companion.PREF_TREND_INTERVAL

class TrendWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    companion object {
        fun updateAppWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
            val views = RemoteViews(context.packageName, R.layout.widget_trend)
            
            // PendingIntent to launch app on click
            val intent = Intent(context, MainActivity::class.java)
            val pendingIntent = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.trend_label, pendingIntent)
            views.setOnClickPendingIntent(R.id.trend_value, pendingIntent)

            val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
            val minutes = prefs.getInt(PREF_TREND_INTERVAL, 10)

            CoroutineScope(Dispatchers.IO).launch {
                val trends = InfluxRepository.fetchTrendData(context, minutes)
                
                // Find max increase
                val maxTrend = trends.maxByOrNull { it.value }
                
                withContext(Dispatchers.Main) {
                    if (maxTrend != null && maxTrend.value > 0) {
                        views.setTextViewText(R.id.trend_label, maxTrend.key.uppercase())
                        views.setTextViewText(R.id.trend_value, "+%.1f".format(maxTrend.value))
                    } else {
                        // Fallback if no specific trend or all decreasing/stable
                        // We could show the max value overall, or just "Stable"
                        // Or if we found nothing:
                        if (trends.isEmpty()) {
                            views.setTextViewText(R.id.trend_label, "No Data")
                            views.setTextViewText(R.id.trend_value, "--")
                        } else {
                            // If everything is decreasing, maybe show the one decreasing the least? 
                            // Or just "Stable" if changes are small.
                            // Requirement says: "am stärksten angestiegen". 
                            // If maxTrend is negative, it means everything decreased.
                            // Let's show the max value (least decrease) anyway, or just "--"
                            if (maxTrend != null) {
                               views.setTextViewText(R.id.trend_label, maxTrend.key.uppercase())
                               views.setTextViewText(R.id.trend_value, "%.1f".format(maxTrend.value)) 
                            } else {
                                views.setTextViewText(R.id.trend_label, "Stable")
                                views.setTextViewText(R.id.trend_value, "--") 
                            }
                        }
                    }
                    appWidgetManager.updateAppWidget(appWidgetId, views)
                }
            }
        }

        fun updateAllWidgets(context: Context) {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val thisWidget = ComponentName(context, TrendWidgetProvider::class.java)
            val allWidgetIds = appWidgetManager.getAppWidgetIds(thisWidget)
            for (appWidgetId in allWidgetIds) {
                updateAppWidget(context, appWidgetManager, appWidgetId)
            }
        }
    }
}
