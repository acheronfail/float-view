package fail.acheron.floatview.location

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import androidx.core.content.ContextCompat
import fail.acheron.floatview.application.LocationProviderAuthorization
import fail.acheron.floatview.application.LocationProviderBackgroundCapture
import fail.acheron.floatview.application.LocationProviderObservation
import fail.acheron.floatview.application.LocationProviderPort
import fail.acheron.floatview.application.LocationProviderState
import java.time.Instant

class AndroidLocationProvider(
    context: Context,
    private val wasResolved: (String) -> Boolean,
) : LocationProviderPort {
    private val applicationContext = context.applicationContext
    private val locationManager =
        applicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private var highAccuracy = false
    override fun setHighAccuracy(enabled: Boolean) { highAccuracy = enabled }
    private var listener: LocationListener? = null
    private var handler: ((LocationProviderObservation) -> Unit)? = null

    @Synchronized
    override fun state(): LocationProviderState {
        val enabled = runCatching {
            if (Build.VERSION.SDK_INT >= 28) locationManager.isLocationEnabled
            else locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        }.getOrDefault(false)
        if (!enabled) {
            return LocationProviderState(
                LocationProviderAuthorization.UNAVAILABLE,
                LocationProviderBackgroundCapture.UNAVAILABLE,
                "Location services are disabled.",
            )
        }
        if (!hasForegroundPermission()) {
            return LocationProviderState(
                if (wasResolved(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                    LocationProviderAuthorization.DENIED
                } else {
                    LocationProviderAuthorization.NOT_DETERMINED
                },
                LocationProviderBackgroundCapture.UNAVAILABLE,
                if (wasResolved(Manifest.permission.ACCESS_COARSE_LOCATION)) "Location permission was denied." else "Location permission has not been resolved.",
            )
        }
        val background = if (hasBackgroundPermission()) {
            LocationProviderBackgroundCapture.AVAILABLE
        } else {
            LocationProviderBackgroundCapture.FOREGROUND_ONLY
        }
        return LocationProviderState(
            if (background == LocationProviderBackgroundCapture.AVAILABLE) {
                LocationProviderAuthorization.AUTHORIZED
            } else {
                LocationProviderAuthorization.FOREGROUND_ONLY
            },
            background,
            if (background == LocationProviderBackgroundCapture.FOREGROUND_ONLY) {
                "Background location access is not enabled."
            } else null,
        )
    }

    @Synchronized
    override fun startUpdates(handler: (LocationProviderObservation) -> Unit) {
        if (!hasForegroundPermission()) return
        stopUpdates()
        this.handler = handler
        val next = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                if (!location.latitude.isFinite() || !location.longitude.isFinite()) return
                this@AndroidLocationProvider.handler?.invoke(
                    LocationProviderObservation(
                        observedAt = Instant.ofEpochMilli(location.time),
                        latitude = location.latitude,
                        longitude = location.longitude,
                        accuracyM = location.accuracy.takeIf { location.hasAccuracy() && it >= 0f }?.toDouble(),
                        altitudeM = location.altitude.takeIf { location.hasAltitude() && it.isFinite() },
                        speedMps = location.speed.takeIf { location.hasSpeed() && it.isFinite() && it >= 0f }?.toDouble(),
                        speedAccuracyMps = if (Build.VERSION.SDK_INT >= 26 && location.hasSpeedAccuracy()) location.speedAccuracyMetersPerSecond.takeIf { it.isFinite() && it >= 0f }?.toDouble() else null,
                        speedAgeMs = ((SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000L).takeIf { it >= 0L },
                    ),
                )
            }
        }
        listener = next
        val providers = (if (highAccuracy) listOf(LocationManager.GPS_PROVIDER) else listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER))
            .filter { runCatching { locationManager.isProviderEnabled(it) }.getOrDefault(false) }
        providers.forEach { provider ->
            try {
                locationManager.requestLocationUpdates(provider, 1_000L, if (highAccuracy) 0f else 5f, next, Looper.getMainLooper())
            } catch (_: SecurityException) {
                // Access can be revoked after the foreground permission check.
            } catch (_: IllegalArgumentException) {
                // A provider can disappear between enumeration and registration.
            }
        }
    }

    @Synchronized
    override fun stopUpdates() {
        listener?.also { locationManager.removeUpdates(it) }
        listener = null
        handler = null
    }

    private fun hasForegroundPermission(): Boolean =
        ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun hasBackgroundPermission(): Boolean =
        Build.VERSION.SDK_INT < 29 || ContextCompat.checkSelfPermission(
            applicationContext,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
}
