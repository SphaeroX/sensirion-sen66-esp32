package com.example.sen66widget

import kotlin.math.max
import kotlin.math.roundToInt

object IaqCalculator {

    data class LatestFields(
        var pm25: Float = Float.NaN,
        var pm10: Float = Float.NaN,
        var co2: Float = Float.NaN,
        var voc: Float = Float.NaN,
        var nox: Float = Float.NaN
    )

    private fun lin(x: Float, x0: Float, x1: Float, y0: Float, y1: Float): Float {
        if (x <= x0) return y0
        if (x >= x1) return y1
        return y0 + (y1 - y0) * ((x - x0) / (x1 - x0))
    }

    private fun clampf(v: Float, a: Float, b: Float): Float {
        return if (v < a) a else if (v > b) b else v
    }

    private fun scorePM25(v: Float): Float {
        if (v.isNaN()) return Float.NaN
        if (v <= 10) return lin(v, 0f, 10f, 0f, 20f)
        if (v <= 25) return lin(v, 10f, 25f, 20f, 50f)
        if (v <= 50) return lin(v, 25f, 50f, 50f, 75f)
        if (v <= 75) return lin(v, 50f, 75f, 75f, 90f)
        return 100f
    }

    private fun scorePM10(v: Float): Float {
        if (v.isNaN()) return Float.NaN
        if (v <= 20) return lin(v, 0f, 20f, 0f, 20f)
        if (v <= 45) return lin(v, 20f, 45f, 20f, 60f)
        if (v <= 100) return lin(v, 45f, 100f, 60f, 90f)
        return 100f
    }

    private fun scoreCO2(v: Float): Float {
        if (v.isNaN()) return Float.NaN
        if (v <= 800) return lin(v, 400f, 800f, 0f, 20f)
        if (v <= 1000) return lin(v, 800f, 1000f, 20f, 40f)
        if (v <= 1400) return lin(v, 1000f, 1400f, 40f, 70f)
        if (v <= 2000) return lin(v, 1400f, 2000f, 70f, 90f)
        return 100f
    }

    private fun scoreVOC(v: Float): Float {
        if (v.isNaN()) return Float.NaN
        if (v <= 100) return 10f
        if (v <= 200) return lin(v, 100f, 200f, 10f, 60f)
        if (v <= 300) return lin(v, 200f, 300f, 60f, 85f)
        if (v <= 500) return lin(v, 300f, 500f, 85f, 100f)
        return 100f
    }

    private fun scoreNOx(v: Float): Float {
        if (v.isNaN()) return Float.NaN
        if (v <= 100) return 10f
        if (v <= 200) return lin(v, 100f, 200f, 10f, 60f)
        if (v <= 300) return lin(v, 200f, 300f, 60f, 85f)
        if (v <= 500) return lin(v, 300f, 500f, 85f, 100f)
        return 100f
    }

    data class IaqResult(val score: Float, val label: String)

    fun computeDominantIndex(f: LatestFields): IaqResult {
        var maxScore = -1f
        var maxLabel = "IAQ" // Default

        val scores = listOf(
            "PM2.5" to scorePM25(f.pm25),
            "PM10" to scorePM10(f.pm10),
            "CO2" to scoreCO2(f.co2),
            "VOC" to scoreVOC(f.voc),
            "NOx" to scoreNOx(f.nox)
        )

        for ((label, score) in scores) {
            if (score.isNaN()) continue
            if (score > maxScore) {
                maxScore = score
                maxLabel = label
            }
        }

        if (maxScore == -1f) return IaqResult(Float.NaN, "--")
        
        // Clamp score 0-100
        val finalScore = clampf(maxScore, 0f, 100f)
        return IaqResult(finalScore, maxLabel)
    }
}
