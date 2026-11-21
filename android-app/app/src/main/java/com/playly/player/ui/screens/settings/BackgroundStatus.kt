package com.playly.player.ui.screens.settings

import android.app.ActivityManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat

/** Stage 9.3: how Android treats Playly in the background (battery setting of the app). */
enum class BatteryMode { Unrestricted, Optimized, Restricted }

data class BackgroundStatus(val battery: BatteryMode, val notificationsEnabled: Boolean)

/** Read on every return to Settings: the user may have changed it in the system screens. */
fun readBackgroundStatus(context: Context): BackgroundStatus {
    val activity = context.getSystemService(ActivityManager::class.java)
    val power = context.getSystemService(PowerManager::class.java)
    val battery = when {
        activity?.isBackgroundRestricted == true -> BatteryMode.Restricted
        power?.isIgnoringBatteryOptimizations(context.packageName) == true -> BatteryMode.Unrestricted
        else -> BatteryMode.Optimized
    }
    return BackgroundStatus(battery, NotificationManagerCompat.from(context).areNotificationsEnabled())
}

/**
 * The app's own system page, where "Battery" offers Unrestricted / Optimized / Restricted.
 * No REQUEST_IGNORE_BATTERY_OPTIMIZATIONS prompt: spec §14 asks for hints, not pressure.
 */
fun openAppDetails(context: Context): Boolean =
    start(context, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)))

fun openNotificationSettings(context: Context): Boolean =
    start(context, Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)) ||
        openAppDetails(context)

private fun start(context: Context, intent: Intent): Boolean = try {
    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    true
} catch (_: ActivityNotFoundException) {
    false
}
