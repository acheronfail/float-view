package fail.acheron.floatview.application

import java.time.Instant

@JvmInline
value class DeviceId(val value: String)


enum class ConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    DISCOVERING_SERVICES,
    ENABLING_NOTIFICATIONS,
    IDENTIFYING,
    SELECTING_CONTROLLER,
    READY,
    RECONNECTING,
    DISCONNECTING,
    FAILED
}


enum class BluetoothRadioState { UNKNOWN, UNSUPPORTED, POWERED_OFF, POWERED_ON, RESETTING }

enum class BluetoothPermissionState {
    UNKNOWN,
    NOT_REQUIRED,
    NOT_DETERMINED,
    DENIED,
    RESTRICTED,
    GRANTED
}

data class BluetoothState(
    val radio: BluetoothRadioState,
    val scanPermission: BluetoothPermissionState,
    val connectPermission: BluetoothPermissionState,
)


enum class LocationProviderAuthorization {
    NOT_DETERMINED,
    FOREGROUND_ONLY,
    AUTHORIZED,
    DENIED,
    RESTRICTED,
    UNAVAILABLE,
}

enum class LocationProviderBackgroundCapture {
    AVAILABLE,
    FOREGROUND_ONLY,
    UNAVAILABLE,
}

data class LocationProviderState(
    val authorization: LocationProviderAuthorization,
    val backgroundCapture: LocationProviderBackgroundCapture,
    val reason: String? = null,
)

data class LocationProviderObservation(
    val observedAt: Instant,
    val latitude: Double,
    val longitude: Double,
    val accuracyM: Double?,
    val speedMps: Double? = null,
    val speedAccuracyMps: Double? = null,
    val speedAgeMs: Long? = null,
    val altitudeM: Double? = null,
)

object LocationUpdated

interface LocationProviderPort {
    fun setHighAccuracy(enabled: Boolean) {}
    fun state(): LocationProviderState
    fun startUpdates(handler: (LocationProviderObservation) -> Unit)
    fun stopUpdates()
}


enum class ThemePreference(val wireValue: String) {
    SYSTEM("system"),
    LIGHT("light"),
    DARK("dark");

    companion object {
        fun fromWire(value: String): ThemePreference? = entries.find { it.wireValue == value }
    }
}


data class BluetoothConnection(val lifetime: Long, val generation: Long)

data class BluetoothProfile(val service: Boolean, val notify: Boolean, val withResponse: Int, val withoutResponse: Int)

sealed interface BluetoothEvent {
    data class Profile(val generation: BluetoothConnection, val profile: BluetoothProfile) : BluetoothEvent
    data class Notifications(val generation: BluetoothConnection, val operation: Long, val success: Boolean) : BluetoothEvent
    data class WriteProgress(val generation: BluetoothConnection, val operation: Long, val progress: String) : BluetoothEvent
    data class StateChanged(val state: BluetoothState) : BluetoothEvent
    data class DeviceFound(
        val deviceId: DeviceId,
        val advertisedName: String?,
        val rssi: Int?,
        val uart: Boolean,
    ) : BluetoothEvent
    data class ScanFailed(val reason: String) : BluetoothEvent
    data class ConnectionChanged(val deviceId: DeviceId, val generation: BluetoothConnection, val state: ConnectionState) : BluetoothEvent
    data class Notification(val deviceId: DeviceId, val generation: BluetoothConnection, val bytes: ByteArray) : BluetoothEvent
}

interface BluetoothPort {
    fun currentState(): BluetoothState
    fun startDiscovery()
    fun stopDiscovery()
    fun connect(deviceId: DeviceId, generation: BluetoothConnection)
    fun enableNotifications(generation: BluetoothConnection, operation: Long)
    fun write(deviceId: DeviceId, generation: BluetoothConnection, operation: Long, response: Boolean, bytes: ByteArray)
    fun disconnect(deviceId: DeviceId, generation: BluetoothConnection)
}
