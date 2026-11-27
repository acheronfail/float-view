import Foundation
import Testing
@testable import FloatViewBackend

@Suite("Native storage startup", .serialized)
struct StartupStorageTests {
  @Test("unsupported data fails without mutation, and a compatible retry can acquire the owner")
  func unsupportedStorageAndRetry() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let marker = root.appendingPathComponent(".schema-version")
    let catalog = root.appendingPathComponent("catalog.sqlite")
    let unsupported = Data("999999".utf8)
    try unsupported.write(to: marker)
    try Data("private data".utf8).write(to: catalog)
    #expect(throws: (any Error).self) {
      try SharedService(root: root, bluetooth: InactiveBluetooth(), location: InactiveLocation())
    }
    #expect(try Data(contentsOf: marker) == unsupported)
    #expect(try Data(contentsOf: catalog) == Data("private data".utf8))
    #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).count == 2)
    // The test restores a recognised disposable version; product UI offers no reset.
    try Data("26".utf8).write(to: marker)
    let service = try SharedService(root: root, bluetooth: InactiveBluetooth(), location: InactiveLocation())
    service.shutdown()
    #expect(try String(contentsOf: marker, encoding: .utf8) == "102")
    let retry = try SharedService(root: root, bluetooth: InactiveBluetooth(), location: InactiveLocation())
    retry.shutdown()
  }
}

private final class InactiveBluetooth: BluetoothPort, @unchecked Sendable {
  func currentState() -> BluetoothState { .init(radio: .unsupported, scanPermission: .denied, connectPermission: .denied) }
  func requestPermission() { Issue.record("Startup requested Bluetooth permission") }
  func startDiscovery() { Issue.record("Startup started discovery") }
  func stopDiscovery() {}
  func connect(_: DeviceID, generation _: BluetoothConnection) { Issue.record("Startup connected a device") }
  func enableNotifications(generation _: BluetoothConnection, operation _: UInt64) {}
  func write(_: Data, to _: DeviceID, generation _: BluetoothConnection, operation _: UInt64, response _: Bool) {}
  func disconnect(_: DeviceID, generation _: BluetoothConnection) {}
}

private final class InactiveLocation: LocationProviderPort, @unchecked Sendable {
  func state() -> LocationProviderState { .init(authorization: .unavailable, backgroundCapture: .unavailable) }
  func refreshAuthorization(_ completion: @escaping @Sendable () -> Void) { completion() }
  func recoverAuthorization(_ completion: @escaping @Sendable (Bool) -> Void) { Issue.record("Startup requested location permission"); completion(false) }
  func startUpdates(_: @escaping @Sendable (LocationProviderObservation) -> Void) { Issue.record("Startup started location capture") }
  func stopUpdates() {}
}
