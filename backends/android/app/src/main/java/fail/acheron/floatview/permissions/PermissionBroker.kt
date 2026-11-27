package fail.acheron.floatview.permissions

import fail.acheron.floatview.bluetooth.BluetoothPermissionHistory
import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.provider.Settings
import android.net.Uri
import fail.acheron.floatview.lifecycle.FloatViewApplication
import fail.acheron.floatview.application.json
import org.json.JSONObject
import java.lang.ref.WeakReference

/** OS observations and presentation only; the shared service selects recovery. */
class PermissionBroker(private val application: FloatViewApplication) : BluetoothPermissionHistory {
    private val preferences = application.getSharedPreferences("permission-history-v1", 0)
    private var activity = WeakReference<Activity>(null)
    private val presentation = PermissionPresentation()

    @Synchronized fun foregroundActivity(): Activity? = activity.get()
    @Synchronized fun attach(value: Activity) { activity = WeakReference(value) }
    @Synchronized fun detach(value: Activity) { if (activity.get() === value) activity.clear() }
    @Synchronized override fun wasResolved(permission: String) = preferences.getBoolean(permission, false)

    private fun grant(permission: String?): JSONObject {
        if (permission == null) return json("access" to "notRequired", "requestable" to false, "rationale" to false)
        val granted = application.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
        val rationale = activity.get()?.shouldShowRequestPermissionRationale(permission) == true
        val resolved = wasResolved(permission)
        val restricted = if (Build.VERSION.SDK_INT >= 23) application.packageManager.isPermissionRevokedByPolicy(permission, application.packageName) else false
        val value = PermissionGrant.observe(true, granted, resolved, rationale, restricted)
        return json("access" to value.access, "requestable" to value.requestable, "rationale" to value.rationale)
    }
    @Synchronized fun observation(bluetoothService: Boolean?, bluetoothSupported: Boolean?): JSONObject = runCatching { readObservation(bluetoothService, bluetoothSupported) }.getOrElse {
        val unknown = json("access" to "unknown", "requestable" to false, "rationale" to false)
        json("platform" to platform(), "bluetooth_scan" to unknown, "bluetooth_connect" to unknown, "location" to unknown,
            "notifications" to unknown, "live_updates" to if (Build.VERSION.SDK_INT >= 36) unknown else null,
            "background_location" to unknown, "accuracy" to "unknown", "scope" to "unknown", "location_services" to null,
            "bluetooth_service" to null, "bluetooth_supported" to null, "background_option_label" to null)
    }
    private fun platform() = when { Build.VERSION.SDK_INT >= 31 -> "android31"; Build.VERSION.SDK_INT == 30 -> "android30"; else -> "android29" }
    private fun readObservation(bluetoothService: Boolean?, bluetoothSupported: Boolean?): JSONObject {
        val coarse = grant(Manifest.permission.ACCESS_COARSE_LOCATION)
        val fine = grant(Manifest.permission.ACCESS_FINE_LOCATION)
        val foreground = if (fine.getString("access") == "granted") fine else coarse.also {
            // Approximate access remains visible, while recovery requests precise access.
            it.put("requestable", fine.getBoolean("requestable"))
            it.put("rationale", fine.getBoolean("rationale"))
        }
        val background = grant(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        val hasForeground = foreground.getString("access") == "granted"
        val services = runCatching { application.getSystemService(LocationManager::class.java).isLocationEnabled }.getOrNull()
        return json("platform" to platform(),
            "bluetooth_scan" to if (Build.VERSION.SDK_INT >= 31) grant(Manifest.permission.BLUETOOTH_SCAN) else fine,
            "bluetooth_connect" to if (Build.VERSION.SDK_INT >= 31) grant(Manifest.permission.BLUETOOTH_CONNECT) else grant(null),
            "location" to foreground, "background_location" to background,
            "notifications" to notificationGrant(),
            "live_updates" to if (Build.VERSION.SDK_INT >= 36) settingsGrant(application.getSystemService(NotificationManager::class.java).canPostPromotedNotifications()) else null,
            "accuracy" to when { fine.getString("access") == "granted" -> "precise"; hasForeground -> "approximate"; else -> "unknown" },
            "scope" to when { !hasForeground -> "unknown"; background.getString("access") == "granted" -> "always"; else -> "whileInUse" },
            "location_services" to services, "bluetooth_service" to bluetoothService, "bluetooth_supported" to bluetoothSupported,
            "background_option_label" to if (Build.VERSION.SDK_INT >= 30) application.packageManager.backgroundPermissionOptionLabel.toString().take(120) else null)
    }
    private fun settingsGrant(allowed: Boolean) = json(
        "access" to if (allowed) "granted" else "denied", "requestable" to false, "rationale" to false,
    )

    private fun notificationGrant(): JSONObject {
        if (Build.VERSION.SDK_INT >= 33) {
            val runtime = grant(Manifest.permission.POST_NOTIFICATIONS)
            if (runtime.getString("access") != "granted") return runtime
        }
        val manager = application.getSystemService(NotificationManager::class.java)
        val channelEnabled = manager.getNotificationChannel("active_logging")?.importance != NotificationManager.IMPORTANCE_NONE
        return settingsGrant(manager.areNotificationsEnabled() && channelEnabled)
    }

    /** Automatic first-ride prompt shares the Settings dialog slot and history. */
    @Synchronized fun requestRideNotifications(connected: Boolean): Boolean {
        if (Build.VERSION.SDK_INT < 33 || wasResolved(Manifest.permission.POST_NOTIFICATIONS) ||
            application.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return true
        val current = activity.get()
        if (!connected || current == null || !current.hasWindowFocus() || presentation.busy()) return false
        if (grant(Manifest.permission.POST_NOTIFICATIONS).getString("access") == "restricted") return true
        recover("notifications", "requestPermission") { }
        return true
    }

    private fun settingsIntent(permission: String): Intent {
        val manager = application.getSystemService(NotificationManager::class.java)
        return when {
            permission == "location" && !application.getSystemService(LocationManager::class.java).isLocationEnabled ->
                Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            permission == "liveUpdates" && Build.VERSION.SDK_INT >= 36 ->
                Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, application.packageName)
            permission == "notifications" && manager.getNotificationChannel("active_logging")?.importance == NotificationManager.IMPORTANCE_NONE ->
                Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, application.packageName)
                    .putExtra(Settings.EXTRA_CHANNEL_ID, "active_logging")
            permission == "notifications" ->
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, application.packageName)
            else -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${application.packageName}"))
        }
    }

    @Synchronized fun recover(permission: String, action: String, done: (Boolean) -> Unit) {
        val current = activity.get()
        val id = presentation.begin(current != null && !current.isFinishing && !current.isDestroyed && current.hasWindowFocus(), done) ?: return
        checkNotNull(current)
        fun finish(success: Boolean) = presentation.finish(id, success)
        current.runOnUiThread {
            var dialog: AlertDialog? = null
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                synchronized(this) {
                    if (presentation.active(id)) { dialog?.dismiss(); finish(false) }
                }
            }, 30_000)
            if (current.isFinishing || current.isDestroyed) { finish(false); return@runOnUiThread }
            val permissions = when (permission) {
                "notifications" -> if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.POST_NOTIFICATIONS) else emptyArray()
                "bluetooth" -> if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT) else emptyArray()
                "location" -> arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
                "backgroundLocation" -> if (Build.VERSION.SDK_INT == 29) arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION) else emptyArray()
                else -> emptyArray()
            }
            val present = {
                runCatching {
                    if (action == "openSettings") {
                        current.startActivity(settingsIntent(permission))
                        finish(true)
                    } else if (action == "requestPermission" && permissions.isNotEmpty()) {
                        if (!presentation.startSystem(id)) return@runCatching
                        if (permission == "notifications") {
                            preferences.edit().putBoolean(Manifest.permission.POST_NOTIFICATIONS, true).apply()
                        }
                        current.requestPermissions(permissions, PERMISSION_REQUEST)
                    } else finish(false)
                }.onFailure { presentation.resolveSystem(false); finish(false) }
                Unit
            }
            val rationale = action == "requestPermission" && permissions.any(current::shouldShowRequestPermissionRationale)
            if (needsPermissionDisclosure(permission, action, rationale)) {
                val message = if (permission == "backgroundLocation") {
                    val label = if (Build.VERSION.SDK_INT >= 30) application.packageManager.backgroundPermissionOptionLabel.toString() else "Allow all the time"
                    "Float View collects location data to record your ride route in the background while your screen is locked or you use another app. Route recording is optional. Ride records are stored on your device. To allow background access, open Permissions, then Location, and choose $label."
                } else if (permission == "notifications") "Notifications show live ride readings while Float View is in the background. Bluetooth and recording work without them."
                else if (permission == "bluetooth") "Float View uses nearby device access to connect to your VESC board over Bluetooth for live readings, ride recording and board configuration."
                else "Float View collects location data to record your ride route, including in the background while your screen is locked or you use another app. Route recording is optional. Ride records are stored on your device. Viewing an online route map sends the viewed map area and network request information to OpenStreetMap." +
                    " Precise location and enabled location services are also required to discover Bluetooth boards, even when route recording is off."
                dialog = runCatching { AlertDialog.Builder(current).setTitle("Permission access").setMessage(message)
                    .setPositiveButton(if (action == "openSettings") "Open settings" else "Continue") { _, _ -> present() }
                    .setNegativeButton("Cancel") { _, _ -> finish(false) }.setOnCancelListener { finish(false) }.show() }.getOrElse { finish(false); null }
            } else present()
        }
    }
    @Synchronized fun recordResult(permissions: Array<out String>) {
        if (!presentation.awaitingSystem()) return
        preferences.edit().also { editor -> permissions.forEach { editor.putBoolean(it, true) } }.apply()
        presentation.resolveSystem(true)
    }
    companion object { const val PERMISSION_REQUEST = 7001 }
}
