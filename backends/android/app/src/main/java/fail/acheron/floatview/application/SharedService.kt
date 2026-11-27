package fail.acheron.floatview.application

import android.os.SystemClock
import java.io.File
import java.util.concurrent.Semaphore
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

data class NativeFilePresentation(val file: File, val fileName: String, val finish: () -> Unit)

/** Bounded OS capability executor. Product policy and state stay in Rust. */
class SharedService(
    context: android.content.Context,
    private val root: File,
    private val bluetooth: BluetoothPort,
    private val location: LocationProviderPort,
    private val permissions: fail.acheron.floatview.permissions.PermissionBroker,
    private val presenter: (NativeFilePresentation) -> Boolean,
    private val foregroundRequiredChanged: (Boolean) -> Unit,
    private val locationChanged: () -> Unit,
) : AutoCloseable {
    private val hermes = HermesAdapter(context, permissions::foregroundActivity)
    private val speechDelegate = lazy {
        fail.acheron.floatview.speech.SpeechAdapter(context) { status, id, reason -> enqueue {
            if (status == "outcome") fact(json("fact" to "speech_finished", "id" to id, "outcome" to reason))
            else fact(json("fact" to "speech_ready", "state" to json("status" to status, "reason" to reason, "loweringControl" to "automatic", "voiceSettingsAvailable" to fail.acheron.floatview.speech.SpeechAdapter.canOpenVoiceSettings(context))))
        } }
    }
    private val speech by speechDelegate
    val handle: Long
    private val executor = ScheduledThreadPoolExecutor(1) { action -> Thread(action, "float-view-os") }
    private var diagnosticCallbacks = 0L
    private var diagnosticQueueDelay = 0L
    private var diagnosticQueueDepth = 0
    private var diagnosticFailures = 0L
    private var diagnosticLastReport = 0L
    private var diagnosticOverflows = 0L // callbackLock
    private val admission = Semaphore(64)
    private val callbackLock = Any()
    private var callbackGeneration = 0L
    private var callbackScan = 0L
    private var overflow: BluetoothConnection? = null
    private var foreground: Boolean? = null
    private var stopRequested = false
    private val presentationsFinished = mutableSetOf<Long>()
    private var lifetime = 0L
    private var sequence = 0L
    private var activeDevice: DeviceId? = null
    private val timers = mutableMapOf<Long, Pair<Long, Boolean>>()
    @Volatile private var lastCapabilities = 0L
    private var foregroundRequired = false
    @Volatile var announcementsEnabled = false; private set
    @Volatile var recording = false; private set
    @Volatile var liveActivity: LiveActivityState? = null; private set
    private var locationState: LocationProviderState? = null
    @Volatile private var closed = false
    @Volatile var theme = ThemePreference.SYSTEM; private set
    private var nextThemeSubscription = 0L
    private val themeHandlers = mutableMapOf<Long, (ThemePreference) -> Unit>()

    init {
        root.mkdirs()
        check(root.isDirectory)
        RustApplicationRuntime.ensureLoaded()
        handle = RustApplicationRuntime.serviceCreate(root.canonicalPath.toByteArray(Charsets.UTF_8))
        check(handle > 0) { "Shared service startup failed" }
    }
    fun start() {
        // Publish the platform inventory before any listener can serve a complete snapshot.
        executor.submit { exchange(json("command" to "drain")); capabilities() }.get(5, TimeUnit.SECONDS)
        speech.refresh()
        executor.scheduleWithFixedDelay({ runCatching { tick() } }, 20, 20, TimeUnit.MILLISECONDS)
    }
    fun setForeground(value: Boolean) { if (value) speech.refresh(); synchronized(callbackLock) { foreground = value; lastCapabilities = 0 } }
    fun requestStop() { synchronized(callbackLock) { stopRequested = true } }
    fun refreshCapabilities() { synchronized(callbackLock) { lastCapabilities = 0 } }
    @Synchronized fun observeTheme(handler: (ThemePreference) -> Unit): AutoCloseable {
        check(themeHandlers.size < 8)
        val id = ++nextThemeSubscription
        themeHandlers[id] = handler
        handler(theme)
        return AutoCloseable { synchronized(this) { themeHandlers.remove(id) } }
    }
    fun receive(event: BluetoothEvent) {
        val scan = synchronized(callbackLock) { callbackScan }
        val generation = when (event) {
            is BluetoothEvent.ConnectionChanged -> event.generation
            is BluetoothEvent.Notification -> event.generation
            is BluetoothEvent.Profile -> event.generation
            is BluetoothEvent.Notifications -> event.generation
            is BluetoothEvent.WriteProgress -> event.generation
            else -> null
        }
        enqueue(generation) {
            if (generation != null && generation.lifetime != lifetime) return@enqueue
            when (event) {
                is BluetoothEvent.StateChanged -> bluetoothFact(event.state)
                is BluetoothEvent.DeviceFound -> fact(json("fact" to "discovered", "scan_id" to scan,
                    "device_id" to event.deviceId.value, "name" to event.advertisedName, "rssi" to event.rssi, "advertises_uart" to event.uart))
                is BluetoothEvent.Profile -> fact(json("fact" to "profile", "generation" to event.generation.generation,
                    "operation" to event.generation.generation, "profile" to json("service" to event.profile.service,
                        "notify" to event.profile.notify, "with_response" to event.profile.withResponse,
                        "without_response" to event.profile.withoutResponse)))
                is BluetoothEvent.Notifications -> fact(json("fact" to "notifications", "generation" to event.generation.generation,
                    "operation" to event.operation, "success" to event.success))
                is BluetoothEvent.WriteProgress -> fact(json("fact" to "write_progress", "generation" to event.generation.generation,
                    "operation" to event.operation, "progress" to event.progress))
                is BluetoothEvent.ScanFailed -> bluetoothFact(bluetooth.currentState())
                is BluetoothEvent.ConnectionChanged -> if (event.deviceId == activeDevice) {
                    val state = when (event.state) {
                        ConnectionState.CONNECTING -> "connecting"
                        ConnectionState.CONNECTED, ConnectionState.DISCOVERING_SERVICES -> "discoveringServices"
                        ConnectionState.ENABLING_NOTIFICATIONS -> "enablingNotifications"
                        ConnectionState.READY -> "ready"
                        ConnectionState.DISCONNECTED -> "disconnected"
                        ConnectionState.FAILED -> "failed"
                        else -> null
                    }
                    if (state != null) fact(json("fact" to "link", "generation" to event.generation.generation, "state" to state))
                }
                is BluetoothEvent.Notification -> if (event.deviceId == activeDevice && event.bytes.size <= 8192) {
                    fact(json("fact" to "bytes", "generation" to event.generation.generation,
                        "bytes" to JSONArray(event.bytes.map { it.toInt() and 255 })))
                }
            }
        }
    }
    private fun enqueue(generation: BluetoothConnection? = null, action: () -> Unit) {
        if (closed) return
        val enqueuedAt = SystemClock.elapsedRealtime()
        if (!admission.tryAcquire()) { synchronized(callbackLock) {
            diagnosticOverflows = (diagnosticOverflows + 1).coerceAtMost(1_000_000)
            if (generation != null && generation.generation == callbackGeneration) overflow = generation
        }; return }
        try {
            val depth = 64 - admission.availablePermits()
            executor.execute { try { if (!closed) {
                diagnosticCallbacks = (diagnosticCallbacks + 1).coerceAtMost(1_000_000)
                diagnosticQueueDelay = maxOf(diagnosticQueueDelay, SystemClock.elapsedRealtime() - enqueuedAt)
                diagnosticQueueDepth = maxOf(diagnosticQueueDepth, depth)
                runCatching(action).onFailure { diagnosticFailures = (diagnosticFailures + 1).coerceAtMost(1_000_000) }
            } } finally { admission.release() } }
        } catch (_: java.util.concurrent.RejectedExecutionException) { admission.release() }
    }
    private fun tick() {
        if (closed) return
        val cleanup = synchronized(callbackLock) {
            val facts = mutableListOf<JSONObject>()
            overflow?.let { if (it.lifetime == lifetime) facts.add(json("fact" to "link", "generation" to it.generation, "state" to "failed")) }; overflow = null
            foreground?.let { foreground = null; facts.add(json("fact" to "foreground", "foreground" to it)) }
            if (stopRequested) { stopRequested = false; facts.add(json("fact" to "stop_requested")) }
            presentationsFinished.forEach { facts.add(json("fact" to "presentation_finished", "id" to it)) }
            presentationsFinished.clear()
            facts
        }
        cleanup.forEach(::fact)
        val now = SystemClock.elapsedRealtime()
        timers.filterValues { it.first <= now }.keys.sorted().take(64).forEach {
            timers.remove(it); fact(json("fact" to "timer", "id" to it))
        }
        fact(json("fact" to "clock"))
        if (now - diagnosticLastReport >= 10_000) {
            diagnosticLastReport = now
            val overflows = synchronized(callbackLock) { val value = diagnosticOverflows; diagnosticOverflows = 0; value }
            val failures = diagnosticFailures
            diagnosticFailures = 0
            fact(json("fact" to "native_diagnostics", "platform" to "android", "os_version" to android.os.Build.VERSION.RELEASE.take(128),
                "callbacks" to diagnosticCallbacks, "max_queue_delay_ms" to diagnosticQueueDelay.coerceAtMost(86_400_000),
                "max_queue_depth" to diagnosticQueueDepth, "overflows" to overflows, "exchange_failures" to failures))
            diagnosticCallbacks = 0; diagnosticQueueDelay = 0; diagnosticQueueDepth = 0
        }
        if (now - lastCapabilities >= 1000) capabilities()
        exchange(json("command" to "drain"))
    }
    private fun capabilities() {
        lastCapabilities = SystemClock.elapsedRealtime()
        val bluetoothState = bluetooth.currentState()
        bluetoothFact(bluetoothState)
        val enabled = when (bluetoothState.radio) { BluetoothRadioState.POWERED_ON -> true; BluetoothRadioState.POWERED_OFF -> false; else -> null }
        fact(json("fact" to "permissions", "observation" to permissions.observation(enabled, when (bluetoothState.radio) { BluetoothRadioState.UNSUPPORTED -> false; BluetoothRadioState.UNKNOWN -> null; else -> true })))
        val state = location.state()
        if (state != locationState) { locationState = state; locationChanged() }
        fact(json("fact" to "storage", "available_bytes" to root.usableSpace.coerceAtLeast(0)))
    }
    private fun bluetoothFact(state: BluetoothState) = fact(json("fact" to "bluetooth", "radio" to wire(state.radio.name),
        "scan" to wire(state.scanPermission.name), "connect" to wire(state.connectPermission.name)))
    private fun fact(value: JSONObject) {
        sequence++
        runCatching { exchange(json("command" to "fact", "envelope" to json("lifetime" to lifetime,
            "sequence" to sequence, "monotonic_ms" to SystemClock.elapsedRealtime(),
            "epoch_ms" to System.currentTimeMillis(), "fact" to value))) }.onFailure {
                diagnosticFailures = (diagnosticFailures + 1).coerceAtMost(1_000_000)
            }
    }
    private fun exchange(value: JSONObject) {
        val input = value.toString().toByteArray(Charsets.UTF_8)
        require(input.size <= 1048576)
        val size = IntArray(1)
        val status = RustApplicationRuntime.serviceApply(handle, input, size)
        check(status == 0)
        check(size[0] in 1..1048576)
        val output = ByteArray(size[0])
        check(RustApplicationRuntime.serviceCopyResult(handle, output, size) == 0)
        val result = JSONObject(String(output, Charsets.UTF_8))
        lifetime = result.getLong("lifetime")
        val effects = result.getJSONArray("effects")
        for (i in 0 until effects.length()) execute(effects.getJSONObject(i))
    }
    private fun execute(value: JSONObject) {
        val id = value.optLong("id")
        when (value.getString("effect")) {
            "scan" -> { synchronized(callbackLock) { callbackScan = value.getLong("scan_id") }; bluetooth.startDiscovery() }
            "stop_scan" -> bluetooth.stopDiscovery()
            "connect" -> {
                speech.refresh()
                synchronized(callbackLock) { callbackGeneration = value.getLong("generation") }
                activeDevice = DeviceId(value.getString("device_id"))
                bluetooth.connect(activeDevice!!, BluetoothConnection(lifetime, value.getLong("generation")))
            }
            "disconnect" -> if (value.getLong("generation") == callbackGeneration) {
                activeDevice?.let { bluetooth.disconnect(it, BluetoothConnection(lifetime, value.getLong("generation"))) }
                activeDevice = null
            }
            "enable_notifications" -> bluetooth.enableNotifications(BluetoothConnection(lifetime, value.getLong("generation")), value.getLong("operation"))
            "write" -> if (value.getLong("generation") == callbackGeneration) activeDevice?.let { device ->
                val bytes = value.getJSONArray("bytes")
                bluetooth.write(device, BluetoothConnection(lifetime, value.getLong("generation")), value.getLong("operation"),
                    value.getString("mode") == "with_response", ByteArray(bytes.length()) { bytes.getInt(it).toByte() })
            }
            "arm_timer" -> { check(timers.containsKey(id) || timers.size < 2048)
                timers[id] = SystemClock.elapsedRealtime() + value.getLong("delay_ms") to value.getBoolean("connection") }
            "cancel_timer" -> timers.remove(id)
            "cancel_connection_timers" -> timers.entries.removeAll { it.value.second }
            "start_location" -> {
                val capture = value.getLong("capture_id")
                location.setHighAccuracy(value.optBoolean("high_accuracy", false))
                location.startUpdates { observation ->
                    val received = android.os.SystemClock.elapsedRealtime()
                    enqueue {
                    observation.speedAgeMs?.let { age ->
                        fact(json("fact" to "location_speed", "capture_id" to capture,
                            "speed_mps" to observation.speedMps, "accuracy_mps" to observation.speedAccuracyMps,
                            "age_ms" to age + (android.os.SystemClock.elapsedRealtime() - received).coerceAtLeast(0)))
                    }
                    fact(json("fact" to "location", "capture_id" to capture, "latitude" to observation.latitude,
                        "longitude" to observation.longitude, "accuracy_m" to observation.accuracyM,
                        "altitude_m" to observation.altitudeM,
                        "observed_at_ms" to observation.observedAt.toEpochMilli()))
                } }
            }
            "stop_location" -> location.stopUpdates()
            "recover_permission" -> {
                val operationLifetime = lifetime
                permissions.recover(value.getString("permission"), value.getString("action")) { success -> enqueue {
                    if (lifetime == operationLifetime) {
                        capabilities()
                        fact(json("fact" to "ui_completed", "id" to id, "success" to success))
                    }
                } }
            }
            "present_file" -> {
                val once = java.util.concurrent.atomic.AtomicBoolean(false)
                val finish = {
                    if (once.compareAndSet(false, true)) synchronized(callbackLock) { presentationsFinished.add(id) }
                    Unit
                }
                val accepted = presenter(NativeFilePresentation(File(value.getString("path")), value.getString("file_name"), finish))
                fact(json("fact" to "presentation_started", "id" to id, "accepted" to accepted))
                if (!accepted) finish()
            }
            "speak" -> speech.speak(value.getJSONObject("speech"))
            "cancel_speech" -> speech.cancel(id)
            "refresh_speech" -> speech.refresh()
            "hermes" -> {
                val operationLifetime = lifetime
                val data = if (value.isNull("data")) null else value.getString("data")
                hermes.handle(value.getString("action"), data) { code, result -> enqueue {
                    if (lifetime == operationLifetime)
                        fact(json("fact" to "hermes_completed", "id" to id, "code" to code, "data" to result))
                } }
            }
            "open_voice_settings" -> {
                val operationLifetime = lifetime
                speech.openVoiceSettings(value.getLong("expires_at_ms")) { success -> enqueue {
                    if (lifetime == operationLifetime) fact(json("fact" to "voice_settings_opened", "id" to id, "success" to success))
                } }
            }
            "live_activity" -> {
                liveActivity = value.optJSONObject("state")?.let(LiveActivityState::decode)
            }
            "host_state" -> {
                val preference = ThemePreference.fromWire(value.getString("theme_preference")) ?: ThemePreference.SYSTEM
                theme = preference
                val handlers = synchronized(this) { themeHandlers.values.toList() }
                handlers.forEach { it(preference) }
                val speechEnabled = value.getBoolean("speech_enabled")
                if (announcementsEnabled != speechEnabled) { announcementsEnabled = speechEnabled; locationChanged() }
                recording = value.getBoolean("recording")
                val active = value.getBoolean("connected") || recording
                if (active != foregroundRequired) { foregroundRequired = active; foregroundRequiredChanged(active) }
            }
        }
    }
    override fun close() {
        if (closed) return
        executor.submit {
            hermes.close()
            if (speechDelegate.isInitialized()) speech.close()
            location.stopUpdates(); bluetooth.stopDiscovery(); activeDevice?.let { bluetooth.disconnect(it, BluetoothConnection(lifetime, callbackGeneration)) }
            check(RustApplicationRuntime.serviceDestroy(handle) == 0)
            closed = true
        }.get(6, TimeUnit.SECONDS)
        executor.shutdownNow()
    }
    private fun wire(value: String): String = value.lowercase().split('_').let { parts -> parts.first() + parts.drop(1).joinToString("") { it.replaceFirstChar(Char::uppercaseChar) } }
}
internal fun json(vararg values: Pair<String, Any?>): JSONObject = JSONObject().also { objectValue ->
    values.forEach { (key, value) -> objectValue.put(key, value ?: JSONObject.NULL) }
}
