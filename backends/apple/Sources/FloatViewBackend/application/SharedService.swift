import CFloatViewApplicationRuntime
import Foundation

public struct NativeFilePresentation: Sendable {
  public let fileURL: URL
  public let fileName: String
  public let finish: @Sendable () -> Void
}

/// Executes OS capabilities only. Rust owns all product state and policy.
public final class SharedService: @unchecked Sendable {
  let handle: UInt64
  private let bluetooth: any BluetoothPort
  private let location: any LocationProviderPort
  private let root: URL
  private var diagnosticCallbacks: UInt64 = 0
  private var diagnosticQueueDelay: UInt64 = 0
  private var diagnosticQueueDepth = 0
  private var diagnosticFailures: UInt64 = 0
  private var diagnosticLastReport: UInt64 = 0
  // Accessed only under callbackLock.
  private var queuedCallbacks = 0
  private var diagnosticOverflows: UInt64 = 0
  private let queue = DispatchQueue(label: "float-view.os-capabilities")
  private let queueKey = DispatchSpecificKey<Bool>()
  private let admission = DispatchSemaphore(value: 64)
  private let callbackLock = NSLock()
  private var callbackGeneration: UInt64 = 0
  private var callbackScan: UInt64 = 0
  private var overflow: BluetoothConnection?
  private var foreground: Bool?
  private var completedPresentations: Set<UInt64> = []
  private var lifetime: UInt64 = 0
  private var sequence: UInt64 = 0
  private var activeDevice: DeviceID?
  private var timers: [UInt64: (UInt64, Bool)] = [:]
  private var poll: DispatchSourceTimer?
  private var lastCapabilities = Date.distantPast
  private var presenter: (@Sendable (NativeFilePresentation) -> Bool)?
  private var themeHandler: (@Sendable (ThemePreference) -> Void)?
  private var liveActivityHandler: (@Sendable (LiveActivityState?) -> Void)?
  private let hermes = HermesAdapter()
  private let speech = SpeechAdapter()
  private var stopped = false
  private var bluetoothPermissionCompletion: (UInt64, UInt64)?

  public init(root: URL, bluetooth: any BluetoothPort, location: any LocationProviderPort) throws {
    self.root = root
    self.bluetooth = bluetooth
    self.location = location
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    #if os(iOS)
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: root.path
      )
    #endif
    let path = Data(root.resolvingSymlinksInPath().path.utf8)
    var handle: UInt64 = 0
    let status = path.withUnsafeBytes {
      float_view_application_runtime_service_create($0.bindMemory(to: UInt8.self).baseAddress, $0.count, &handle)
    }
    guard status == 0, handle != 0 else { throw CocoaError(.fileReadUnknown) }
    self.handle = handle
    queue.setSpecific(key: queueKey, value: true)
  }

  public func start(presenter: (@Sendable (NativeFilePresentation) -> Bool)? = nil,
                    liveActivity: (@Sendable (LiveActivityState?) -> Void)? = nil,
                    theme: (@Sendable (ThemePreference) -> Void)? = nil) throws
  {
    try queue.sync {
      self.presenter = presenter
      themeHandler = theme
      liveActivityHandler = liveActivity
      guard poll == nil else { return }
      try exchange(["command": "drain"])
      location.refreshAuthorization { [weak self] in self?.enqueue { $0.capabilities() } }
      capabilities()
      speech.report = { [weak self] status, id, reason in
        self?.enqueue { service in
          if status == "outcome" {
            service.fact([
              "fact": "speech_finished",
              "id": id,
              "outcome": reason ?? "unavailable",
            ])
          } else {
            #if os(iOS)
              let lowering = "adjustable"
            #else
              let lowering = "automatic"
            #endif
            service.fact([
              "fact": "speech_ready",
              "state": [
                "status": status,
                "reason": reason as Any? ?? NSNull(),
                "loweringControl": lowering,
                "voiceSettingsAvailable": false,
              ],
            ])
          }
        }
      }
      speech.refresh()
      let timer = DispatchSource.makeTimerSource(queue: queue)
      timer.schedule(deadline: .now(), repeating: .milliseconds(20), leeway: .milliseconds(5))
      timer.setEventHandler { [weak self] in self?.tick() }
      poll = timer
      timer.resume()
    }
  }

  public func setForeground(_ foreground: Bool) {
    callbackLock.withLock { self.foreground = foreground }
  }

  public func receive(_ event: BluetoothEvent) {
    let scan = callbackLock.withLock { callbackScan }
    let generation: BluetoothConnection? = switch event {
    case let .connectionChanged(_, generation, _), let .notification(_, generation, _),
         let .profile(generation, _), let .notifications(generation, _, _),
         let .writeProgress(generation, _, _): generation
    default: nil
    }
    enqueue(generation: generation) { service in
      if let generation, generation.lifetime != service.lifetime {
        return
      }
      switch event {
      case let .stateChanged(state): service.bluetoothFact(state)
      case let .deviceFound(id, name, rssi, uart):
        service.fact(["fact": "discovered", "scan_id": scan, "device_id": id.value,
                      "advertises_uart": uart, "name": name as Any? ?? NSNull(), "rssi": rssi as Any? ?? NSNull()])
      case let .profile(generation, profile):
        service.fact(["fact": "profile", "generation": generation.generation, "operation": generation.generation,
                      "profile": ["service": profile.service, "notify": profile.notify,
                                  "with_response": profile.withResponse, "without_response": profile.withoutResponse]])
      case let .notifications(generation, operation, success):
        service.fact([
          "fact": "notifications",
          "generation": generation.generation,
          "operation": operation,
          "success": success,
        ])
      case let .writeProgress(generation, operation, progress):
        service.fact([
          "fact": "write_progress",
          "generation": generation.generation,
          "operation": operation,
          "progress": progress,
        ])
      case .scanFailed: service.bluetoothFact(service.bluetooth.currentState())
      case let .connectionChanged(id, generation, state):
        guard service.activeDevice == id else { return }
        let wire: String
        switch state {
        case .connecting: wire = "connecting"
        case .connected, .discoveringServices: wire = "discoveringServices"
        case .enablingNotifications: wire = "enablingNotifications"
        case .ready: wire = "ready"
        case .disconnected: wire = "disconnected"
        case .failed: wire = "failed"
        default: return
        }
        service.fact(["fact": "link", "generation": generation.generation, "state": wire])
      case let .notification(id, generation, bytes):
        guard service.activeDevice == id, bytes.count <= 8192 else { return }
        service.fact(["fact": "bytes", "generation": generation.generation, "bytes": Array(bytes)])
      }
    }
  }

  private func enqueue(generation: BluetoothConnection? = nil, _ action: @escaping @Sendable (SharedService) -> Void) {
    guard admission.wait(timeout: .now()) == .success else {
      callbackLock.withLock {
        diagnosticOverflows = min(1_000_000, diagnosticOverflows + 1)
        if let generation, generation.generation == callbackGeneration {
          overflow = generation
        }
      }
      return
    }
    let enqueuedAt = DispatchTime.now().uptimeNanoseconds
    let depth = callbackLock.withLock { queuedCallbacks += 1; return queuedCallbacks }
    queue.async { [self] in
      defer {
        callbackLock.withLock { queuedCallbacks -= 1 }
        admission.signal()
      }
      guard !stopped else { return }
      diagnosticCallbacks = min(1_000_000, diagnosticCallbacks + 1)
      diagnosticQueueDelay = max(diagnosticQueueDelay, (DispatchTime.now().uptimeNanoseconds - enqueuedAt) / 1_000_000)
      diagnosticQueueDepth = max(diagnosticQueueDepth, depth)
      action(self)
    }
  }

  private func tick() {
    guard !stopped else { return }
    if let generation = callbackLock.withLock({ let value = overflow; overflow = nil; return value }) {
      if generation
        .lifetime == lifetime
      {
        fact(["fact": "link", "generation": generation.generation, "state": "failed"])
      }
    }
    let cleanup = callbackLock.withLock { () -> (Bool?, Set<UInt64>) in
      let result = (foreground, completedPresentations)
      foreground = nil
      completedPresentations.removeAll()
      return result
    }
    if let foreground = cleanup.0 {
      fact(["fact": "foreground", "foreground": foreground])
      if foreground {
        speech.refresh()
        location.refreshAuthorization { [weak self] in self?.enqueue { $0.capabilities() } }
      }
    }
    for id in cleanup.1 {
      fact(["fact": "presentation_finished", "id": id])
    }
    let now = UInt64(ProcessInfo.processInfo.systemUptime * 1000)
    let due = timers.filter { $0.value.0 <= now }.keys.sorted().prefix(64)
    for id in due {
      timers.removeValue(forKey: id)
      fact(["fact": "timer", "id": id])
    }
    fact(["fact": "clock"])
    if now >= diagnosticLastReport + 10_000 {
      diagnosticLastReport = now
      let overflows = callbackLock.withLock { let value = diagnosticOverflows; diagnosticOverflows = 0; return value }
      #if os(iOS)
        let platform = "ios"
      #else
        let platform = "macos"
      #endif
      let failures = diagnosticFailures
      diagnosticFailures = 0
      fact(["fact": "native_diagnostics", "platform": platform,
            "os_version": "\(ProcessInfo.processInfo.operatingSystemVersion.majorVersion).\(ProcessInfo.processInfo.operatingSystemVersion.minorVersion).\(ProcessInfo.processInfo.operatingSystemVersion.patchVersion)",
            "callbacks": diagnosticCallbacks, "max_queue_delay_ms": min(86_400_000, diagnosticQueueDelay),
            "max_queue_depth": min(64, diagnosticQueueDepth), "overflows": overflows,
            "exchange_failures": min(1_000_000, failures)])
      diagnosticCallbacks = 0; diagnosticQueueDelay = 0; diagnosticQueueDepth = 0
    }
    if Date().timeIntervalSince(lastCapabilities) >= 1 {
      capabilities()
    }
    try? exchange(["command": "drain"])
  }

  private func capabilities() {
    lastCapabilities = Date()
    bluetoothFact(bluetooth.currentState())
    permissionFacts()
    let available = (try? root.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
      .volumeAvailableCapacityForImportantUsage) ?? 0
    fact(["fact": "storage", "available_bytes": max(0, available)])
  }

  private func bluetoothFact(_ state: BluetoothState) {
    func wire(_ raw: String) -> String {
      switch raw {
      case "powered_on": "poweredOn"
      case "powered_off": "poweredOff"
      case "not_required": "notRequired"
      case "not_determined": "notDetermined"
      default: raw
      }
    }
    fact(["fact": "bluetooth", "radio": wire(state.radio.rawValue),
          "scan": wire(state.scanPermission.rawValue), "connect": wire(state.connectPermission.rawValue)])
  }

  private func fact(_ value: [String: Any]) {
    sequence += 1
    do { try exchange(["command": "fact", "envelope": ["lifetime": lifetime, "sequence": sequence,
                                                       "monotonic_ms": UInt64(ProcessInfo.processInfo
                                                         .systemUptime * 1000),
                                                       "epoch_ms": Int64(Date().timeIntervalSince1970 * 1000),
                                                       "fact": value]])
    } catch { diagnosticFailures = min(1_000_000, diagnosticFailures + 1) }
  }

  private func exchange(_ command: [String: Any]) throws {
    let input = try JSONSerialization.data(withJSONObject: command)
    guard input.count <= 1_048_576 else { throw CocoaError(.validationMissingMandatoryProperty) }
    var required = 0
    let status = input.withUnsafeBytes {
      float_view_application_runtime_service_apply(
        handle,
        $0.bindMemory(to: UInt8.self).baseAddress,
        $0.count,
        &required
      )
    }
    guard status == 0, required <= 1_048_576 else { throw CocoaError(.validationMissingMandatoryProperty) }
    var output = [UInt8](repeating: 0, count: required)
    let copied = output.withUnsafeMutableBufferPointer {
      float_view_application_runtime_service_copy_result(handle, $0.baseAddress, $0.count, &required)
    }
    guard copied == 0, let result = try JSONSerialization.jsonObject(with: Data(output)) as? [String: Any],
          let lifetime = result["lifetime"] as? NSNumber, let effects = result["effects"] as? [[String: Any]]
    else {
      throw CocoaError(.validationMissingMandatoryProperty)
    }
    self.lifetime = lifetime.uint64Value
    for effect in effects {
      execute(effect)
    }
  }

  private func execute(_ value: [String: Any]) {
    func number(_ key: String) -> UInt64 {
      (value[key] as? NSNumber)?.uint64Value ?? 0
    }
    let id = number("id")
    switch value["effect"] as? String {
    case "scan":
      callbackLock.withLock { callbackScan = number("scan_id") }
      bluetooth.startDiscovery()
    case "stop_scan": bluetooth.stopDiscovery()
    case "connect":
      speech.refresh()
      guard let device = value["device_id"] as? String else { return }
      callbackLock.withLock { callbackGeneration = number("generation") }
      activeDevice = DeviceID(device)
      bluetooth.connect(
        DeviceID(device),
        generation: BluetoothConnection(lifetime: lifetime, generation: number("generation"))
      )
    case "disconnect":
      guard number("generation") == callbackLock.withLock({ callbackGeneration }) else { return }
      if let activeDevice {
        bluetooth.disconnect(
          activeDevice,
          generation: BluetoothConnection(lifetime: lifetime, generation: number("generation"))
        )
      }
      activeDevice = nil
    case "enable_notifications":
      bluetooth.enableNotifications(
        generation: BluetoothConnection(lifetime: lifetime, generation: number("generation")),
        operation: number("operation")
      )
    case "write":
      guard number("generation") == callbackLock.withLock({ callbackGeneration }),
            let activeDevice, let bytes = value["bytes"] as? [UInt8] else { return }
      bluetooth.write(
        Data(bytes),
        to: activeDevice,
        generation: BluetoothConnection(lifetime: lifetime, generation: number("generation")),
        operation: number("operation"),
        response: value["mode"] as? String == "with_response"
      )
    case "hermes":
      guard let action = value["action"] as? String else { return }
      let operationLifetime = lifetime
      hermes.handle(action, data: value["data"] as? String) { [weak self] code, data in
        self?.enqueue { service in
          guard operationLifetime == service.lifetime else { return }
          service.fact(["fact": "hermes_completed", "id": id, "code": code, "data": data as Any? ?? NSNull()])
        }
      }
    case "open_voice_settings":
      fact(["fact": "voice_settings_opened", "id": id, "success": false])
    case "refresh_speech": speech.refresh()
    case "cancel_speech": speech.cancel(id)
    case "speak":
      if let value = value["speech"], let data = try? JSONSerialization.data(withJSONObject: value),
         let request = try? JSONDecoder().decode(SpeechRequest.self, from: data)
      {
        speech.speak(request)
      }
    case "arm_timer":
      guard timers[id] != nil || timers.count < 2048 else { return }
      timers[id] = (
        UInt64(ProcessInfo.processInfo.systemUptime * 1000) + number("delay_ms"),
        value["connection"] as? Bool ?? false
      )
    case "cancel_timer": timers.removeValue(forKey: id)
    case "cancel_connection_timers":
      timers = timers.filter { !$0.value.1 }
    case "start_location":
      let capture = number("capture_id")
      location.setHighAccuracy(value["high_accuracy"] as? Bool ?? false)
      location.startUpdates { [weak self] observation in
        let received = ProcessInfo.processInfo.systemUptime
        self?.enqueue { service in
          if let age = observation.speedAgeMs {
            service.fact(["fact": "location_speed", "capture_id": capture,
                          "speed_mps": observation.speedMps as Any? ?? NSNull(),
                          "accuracy_mps": observation.speedAccuracyMps as Any? ?? NSNull(),
                          "age_ms": age + UInt64(max(0, ProcessInfo.processInfo.systemUptime - received) * 1000)])
          }
          service.fact(["fact": "location", "capture_id": capture, "latitude": observation.latitude,
                        "longitude": observation.longitude, "accuracy_m": observation.accuracyM as Any? ?? NSNull(),
                        "altitude_m": observation.altitudeM as Any? ?? NSNull(),
                        "observed_at_ms": Int64(observation.observedAt.timeIntervalSince1970 * 1000)])
        }
      }
    case "stop_location": location.stopUpdates()
    case "recover_permission":
      guard let permission = value["permission"] as? String, let action = value["action"] as? String else { return }
      let operationLifetime = lifetime
      let complete: @Sendable (Bool) -> Void = { [weak self] success in
        self?.enqueue { service in
          guard service.lifetime == operationLifetime else { return }
          service.capabilities()
          service.fact(["fact": "ui_completed", "id": id, "success": success])
        }
      }
      if action == "openSettings" {
        openPermissionSettings(permission, completion: complete)
      } else if permission == "location" {
        location.recoverAuthorization(complete)
      } else if permission == "bluetooth" {
        bluetoothPermissionCompletion = (id, UInt64(ProcessInfo.processInfo.systemUptime * 1000) + 30_000)
        bluetooth.requestPermission()
      } else {
        complete(false)
      }
    case "present_file":
      guard let path = value["path"] as? String, let name = value["file_name"] as? String else { return }
      let once = PresentationCompletion()
      let finish: @Sendable () -> Void = { [weak self] in
        guard once.claim(), let self else { return }
        _ = self.callbackLock.withLock { self.completedPresentations.insert(id) }
      }
      let accepted = presenter?(NativeFilePresentation(
        fileURL: URL(fileURLWithPath: path),
        fileName: name,
        finish: finish
      )) == true
      fact(["fact": "presentation_started", "id": id, "accepted": accepted])
      if !accepted {
        finish()
      }
    case "live_activity":
      if let liveActivityHandler {
        if value["state"] is NSNull {
          liveActivityHandler(nil)
        } else if let raw = value["state"],
                  let data = try? JSONSerialization.data(withJSONObject: raw)
        {
          let decoder = JSONDecoder()
          decoder.keyDecodingStrategy = .convertFromSnakeCase
          if let state = try? decoder.decode(LiveActivityState.self, from: data) {
            liveActivityHandler(state)
          }
        }
      }
    case "host_state":
      if let theme = value["theme_preference"] as? String,
         let preference = ThemePreference(rawValue: theme)
      {
        themeHandler?(preference)
      }
    default: break
    }
  }

  private func permissionFacts() {
    let state = bluetooth.currentState()
    let access = location.access()
    func grant(_ value: String, _ requestable: Bool) -> [String: Any] {
      ["access": value, "requestable": requestable, "rationale": false]
    }
    func permission(_ value: BluetoothPermissionState) -> String {
      switch value { case .notDetermined: "notDetermined"; case .notRequired: "notRequired"; default: value.rawValue }
    }
    #if os(iOS)
      let platform = "ios"
    #else
      let platform = "macos"
    #endif
    let service: Bool? = state.radio == .poweredOn ? true : state.radio == .poweredOff ? false : nil
    let supported: Bool? = state.radio == .unsupported ? false : state.radio == .unknown ? nil : true
    fact(["fact": "permissions", "observation": [
      "platform": platform, "bluetooth_scan": grant(
        permission(state.scanPermission),
        state.scanPermission == .notDetermined
      ),
      "bluetooth_connect": grant(permission(state.connectPermission), state.connectPermission == .notDetermined),
      "location": grant(access.grant, access.requestable), "background_location": grant("notRequired", false),
      "accuracy": access.accuracy, "scope": access.scope, "location_services": access.services as Any? ?? NSNull(),
      "bluetooth_service": service as Any? ?? NSNull(), "bluetooth_supported": supported as Any? ?? NSNull(),
      "background_option_label": NSNull(),
      "notifications": NSNull(), "live_updates": NSNull(),
    ]])
    if let (id, deadline) = bluetoothPermissionCompletion {
      let expired = UInt64(ProcessInfo.processInfo.systemUptime * 1000) >= deadline
      if state.scanPermission != .notDetermined && state.scanPermission != .unknown || expired {
        bluetoothPermissionCompletion = nil
        fact(["fact": "ui_completed", "id": id, "success": !expired])
      }
    }
  }

  public func shutdown() {
    speech.close()
    let stop = { [self] in
      guard !stopped else { return }
      poll?.cancel(); poll = nil
      timers.removeAll()
      location.stopUpdates()
      bluetooth.stopDiscovery()
      if let activeDevice {
        bluetooth.disconnect(
          activeDevice,
          generation: BluetoothConnection(lifetime: lifetime, generation: callbackLock.withLock { callbackGeneration })
        )
      }
      stopped = float_view_application_runtime_service_destroy(handle) == 0
    }
    if DispatchQueue.getSpecific(key: queueKey) == true {
      stop()
    } else {
      queue.sync(execute: stop)
    }
  }

  deinit { shutdown() }
}

private final class PresentationCompletion: @unchecked Sendable {
  private let lock = NSLock()
  private var completed = false
  func claim() -> Bool {
    lock.withLock {
      guard !completed else { return false }
      completed = true
      return true
    }
  }
}
