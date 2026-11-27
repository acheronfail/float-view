import CoreLocation
@testable import FloatViewBackend
import Foundation
import Testing

@Test
func coreLocationRidePermissions() throws {
  // Core Location's When In Use case (4) is unavailable by name on macOS;
  // exercise its mapping here as well as on iOS.
  let whenInUse = try #require(CLAuthorizationStatus(rawValue: 4))
  #expect(CoreLocationAdapter.providerState(servicesEnabled: true, authorization: .authorizedAlways)
    == LocationProviderState(authorization: .authorized, backgroundCapture: .available))
  for authorization in [whenInUse, .authorizedAlways] {
    #expect(CoreLocationAdapter.providerState(servicesEnabled: false, authorization: authorization)
      .authorization == .unavailable)
  }
  let limited = CoreLocationAdapter.providerState(servicesEnabled: true, authorization: whenInUse)
  #expect(limited.authorization == .foregroundOnly)
  #expect(limited.backgroundCapture == .foregroundOnly)
  #expect(limited.reason?.contains("Always") == true)
  for (authorization, expected) in [
    (CLAuthorizationStatus.notDetermined, LocationProviderAuthorization.notDetermined),
    (.denied, .denied),
    (.restricted, .restricted),
  ] {
    let state = CoreLocationAdapter.providerState(servicesEnabled: true, authorization: authorization)
    #expect(state.authorization == expected)
    #expect(state.backgroundCapture == .unavailable)
  }
}

@Test
func coreLocationObservationDeliveryLeavesTheDelegateThread() {
  let adapter = CoreLocationAdapter()
  let delivery = LocationDeliveryCapture()
  let delegateThread = pthread_mach_thread_np(pthread_self())
  adapter.startUpdates { _ in delivery.recordCurrentThread() }

  adapter.locationManager(
    CLLocationManager(),
    didUpdateLocations: [CLLocation(
      coordinate: CLLocationCoordinate2D(latitude: 1, longitude: 2),
      altitude: 0,
      horizontalAccuracy: 5,
      verticalAccuracy: 5,
      timestamp: Date()
    )]
  )

  #expect(delivery.wait() == .success)
  #expect(delivery.threadID != delegateThread)
  adapter.stopUpdates()
}

@Test
func coreLocationDeliversAltitudeOnlyWithValidVerticalAccuracy() {
  for accuracy in [5.0, 0.0, -1.0] {
    let adapter = CoreLocationAdapter()
    let capture = CalibrationLocationCapture()
    adapter.startUpdates { capture.save($0) }
    let fix = CLLocation(
      coordinate: CLLocationCoordinate2D(latitude: 1, longitude: 2),
      altitude: -12,
      horizontalAccuracy: 5,
      verticalAccuracy: accuracy,
      timestamp: Date()
    )
    adapter.locationManager(CLLocationManager(), didUpdateLocations: [fix])
    #expect(capture.wait() == .success)
    #expect(capture.value?.latitude == 1)
    #expect(capture.value?.altitudeM == (accuracy > 0 ? fix.ellipsoidalAltitude : nil))
    adapter.stopUpdates()
  }
}

private final class LocationDeliveryCapture: @unchecked Sendable {
  private let lock = NSLock()
  private let semaphore = DispatchSemaphore(value: 0)
  private var value: UInt32?

  var threadID: UInt32? {
    lock.withLock { value }
  }

  func recordCurrentThread() {
    lock.withLock { value = pthread_mach_thread_np(pthread_self()) }
    semaphore.signal()
  }

  func wait() -> DispatchTimeoutResult {
    semaphore.wait(timeout: .now() + 2)
  }
}

@Test
func coreLocationAlwaysUpgrade() throws {
  let whenInUse = try #require(CLAuthorizationStatus(rawValue: 4))
  var request = LocationPermissionRequest()
  #expect(request.authorizationChanged(whenInUse) == nil)
  #expect(request.begin(authorization: .notDetermined) == .whenInUse)
  #expect(request.authorizationChanged(.notDetermined) == nil)
  #expect(request.authorizationChanged(whenInUse) == .always)
  #expect(request.authorizationChanged(whenInUse) == nil)
  #expect(request.authorizationChanged(.authorizedAlways) == nil)
  #expect(request.begin(authorization: whenInUse) == .always)
  for status in [CLAuthorizationStatus.denied, .restricted, .authorizedAlways] {
    #expect(request.begin(authorization: status) == nil)
    #expect(request.begin(authorization: .notDetermined) == .whenInUse)
    #expect(request.authorizationChanged(status) == nil)
    #expect(request.authorizationChanged(whenInUse) == nil)
  }
}

@Test
func permissionInventorySeparatesGrantFromDisabledServicesAndAccuracy() throws {
  let whenInUse = try #require(CLAuthorizationStatus(rawValue: 4))
  let access = CoreLocationAdapter.accessState(
    servicesEnabled: false,
    authorization: whenInUse,
    accuracy: "approximate"
  )
  #expect(access.grant == "granted")
  #expect(access.scope == "whileInUse")
  #expect(access.accuracy == "approximate")
  #expect(access.services == false)
  #expect(access.requestable == false)
  for authorization in [CLAuthorizationStatus.denied, .restricted, .notDetermined] {
    let access = CoreLocationAdapter.accessState(
      servicesEnabled: true,
      authorization: authorization,
      accuracy: "precise"
    )
    #expect(access.accuracy == "unknown")
    #expect(access.requestable == (authorization == .notDetermined))
  }
}

@Test
func coreLocationPreservesSpeedUncertaintyAndMeasurementAge() {
  let adapter = CoreLocationAdapter()
  let capture = CalibrationLocationCapture()
  adapter.startUpdates { capture.save($0) }
  adapter.locationManager(CLLocationManager(), didUpdateLocations: [CLLocation(
    coordinate: CLLocationCoordinate2D(latitude: 1, longitude: 2), altitude: 0,
    horizontalAccuracy: 5, verticalAccuracy: 5, course: 0, courseAccuracy: 1,
    speed: 5, speedAccuracy: 0.1, timestamp: Date().addingTimeInterval(-0.2)
  )])
  #expect(capture.wait() == .success)
  #expect(capture.value?.speedMps == 5)
  #expect(capture.value?.speedAccuracyMps == 0.1)
  #expect((capture.value?.speedAgeMs ?? 10000) < 2000)
  adapter.stopUpdates()
}

private final class CalibrationLocationCapture: @unchecked Sendable {
  private let lock = NSLock()
  private let semaphore = DispatchSemaphore(value: 0)
  private var observation: LocationProviderObservation?
  var value: LocationProviderObservation? {
    lock.withLock { observation }
  }

  func save(_ value: LocationProviderObservation) {
    lock.withLock { observation = value }; semaphore.signal()
  }

  func wait() -> DispatchTimeoutResult {
    semaphore.wait(timeout: .now() + 2)
  }
}
