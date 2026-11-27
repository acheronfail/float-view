import Foundation
import Security
#if os(iOS)
  import UIKit
#elseif os(macOS)
  import AppKit
#endif

/// Native credential entry, protected storage and HTTPS for the shared service.
final class HermesAdapter: Sendable {
  typealias ResultHandler = @Sendable (Int, String?) -> Void

  func handle(_ action: String, data: String?, complete: @escaping ResultHandler) {
    switch action {
    case "prompt":
      Task { @MainActor in self.prompt(complete) }
    case "read":
      let (status, data) = read()
      complete(status, data)
    case "store":
      complete(data.map { store($0) } == true ? 200 : 0, nil)
    case "clear":
      let status = SecItemDelete(query as CFDictionary)
      complete(status == errSecSuccess || status == errSecItemNotFound ? 200 : 0, nil)
    case "request":
      Task { await self.request(data, complete: complete) }
    default:
      complete(0, nil)
    }
  }

  private var query: [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String:
      (Bundle.main.bundleIdentifier ?? "fail.acheron.floatview") + ".ride-hermes",
      kSecAttrAccount as String: "linked-account"]
  }

  private func read() -> (Int, String?) {
    var attributes = query
    attributes[kSecReturnData as String] = true
    attributes[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(attributes as CFDictionary, &result)
    if status == errSecItemNotFound {
      return (200, nil)
    }
    guard status == errSecSuccess, let data = result as? Data, data.count <= 4096 else { return (0, nil) }
    return (200, String(data: data, encoding: .utf8))
  }

  private func store(_ value: String) -> Bool {
    let bytes = Data(value.utf8)
    guard bytes.count <= 4096 else { return false }
    let changes = [kSecValueData as String: bytes]
    let status = SecItemUpdate(query as CFDictionary, changes as CFDictionary)
    if status == errSecSuccess {
      return true
    }
    guard status == errSecItemNotFound else { return false }
    var attributes = query
    attributes[kSecValueData as String] = bytes
    #if os(iOS)
      attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    #endif
    return SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess
  }

  @MainActor private func prompt(_ complete: @escaping ResultHandler) {
    #if os(iOS)
      let window = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        .filter { $0.activationState == .foregroundActive }.flatMap(\.windows).first { $0.isKeyWindow }
      guard let presenter = window?.rootViewController, presenter.presentedViewController == nil else {
        complete(0, nil)
        return
      }
      let alert = UIAlertController(
        title: "Sign in to Ride Hermes",
        message: "Use your Ride Hermes account to upload rides from Float View.",
        preferredStyle: .alert
      )
      alert.addTextField { field in
        field.placeholder = "Email address"
        field.accessibilityLabel = "Email address"
        field.keyboardType = .emailAddress
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.textContentType = .username
      }
      alert.addTextField { field in
        field.placeholder = "Password"
        field.accessibilityLabel = "Password"
        field.isSecureTextEntry = true
        field.textContentType = .password
      }
      alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in complete(204, nil) })
      let signIn = UIAlertAction(title: "Sign in", style: .default) { [weak alert] _ in
        guard let fields = alert?.textFields, fields.count == 2 else { complete(0, nil); return }
        let password = fields[1].text ?? ""
        fields[1].text = nil
        self.credentials(email: fields[0].text ?? "", password: password, complete: complete)
      }
      signIn.isEnabled = false
      for field in alert.textFields ?? [] {
        field.addAction(UIAction { [weak alert, weak signIn] _ in
          guard let fields = alert?.textFields, fields.count == 2 else { return }
          let email = fields[0].text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
          signIn?.isEnabled = !email.isEmpty && !(fields[1].text ?? "").isEmpty
        }, for: .editingChanged)
      }
      alert.addAction(signIn)
      alert.preferredAction = signIn
      presenter.present(alert, animated: true)
    #elseif os(macOS)
      guard let window = NSApp.keyWindow, window.attachedSheet == nil else { complete(0, nil); return }
      let alert = NSAlert()
      alert.messageText = "Sign in to Ride Hermes"
      alert.informativeText = "Use your Ride Hermes account to upload rides from Float View."
      let signIn = alert.addButton(withTitle: "Sign in")
      alert.addButton(withTitle: "Cancel")
      let email = NSTextField()
      email.placeholderString = "Email address"
      email.setAccessibilityLabel("Email address")
      let password = NSSecureTextField()
      password.placeholderString = "Password"
      password.setAccessibilityLabel("Password")
      let fields = NSStackView(views: [email, password])
      fields.orientation = .vertical
      fields.alignment = .leading
      fields.spacing = 8
      fields.frame = NSRect(x: 0, y: 0, width: 260, height: 58)
      email.widthAnchor.constraint(equalToConstant: 260).isActive = true
      password.widthAnchor.constraint(equalToConstant: 260).isActive = true
      alert.accessoryView = fields
      alert.window.initialFirstResponder = email
      let validator = HermesCredentialsValidator(email: email, password: password, signIn: signIn)
      email.delegate = validator
      password.delegate = validator
      signIn.isEnabled = false
      alert.beginSheetModal(for: window) { [validator] response in
        defer { withExtendedLifetime(validator) {} }
        let secret = password.stringValue
        password.stringValue = ""
        if response == .alertFirstButtonReturn {
          self.credentials(email: email.stringValue, password: secret, complete: complete)
        } else {
          complete(204, nil)
        }
      }
    #endif
  }

  private func credentials(email: String, password: String, complete: ResultHandler) {
    let data = try? JSONSerialization.data(withJSONObject: ["email": email, "password": password])
    complete(200, data.flatMap { String(data: $0, encoding: .utf8) })
  }

  private struct Request: Decodable {
    let route: String
    let organization: String
    let api_key: String
    let token: String?
    let body: String
  }

  private func request(_ data: String?, complete: ResultHandler) async {
    guard let data, let value = try? JSONDecoder().decode(Request.self, from: Data(data.utf8)),
          ["auth", "rides"].contains(value.route), value.body.utf8.count <= 384 * 1024,
          let url = URL(string: "https://ridehermes.app/api/developer/v0/" + value.route)
    else { complete(0, nil); return }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpShouldSetCookies = false
    configuration.timeoutIntervalForRequest = 12
    configuration.timeoutIntervalForResource = 24
    let session = URLSession(configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.httpBody = Data(value.body.utf8)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(value.organization, forHTTPHeaderField: "organization")
    request.setValue(value.api_key, forHTTPHeaderField: "api_key")
    if let token = value.token {
      request.setValue(token, forHTTPHeaderField: "auth_token")
    }
    do {
      let (stream, response) = try await session.bytes(for: request)
      let code = (response as? HTTPURLResponse)?.statusCode ?? 0
      guard (200 ..< 300).contains(code) else { complete(code, nil); return }
      var body = Data()
      for try await byte in stream {
        guard body.count < 32_768 else { complete(code, nil); return }
        body.append(byte)
      }
      complete(code, String(data: body, encoding: .utf8))
    } catch { complete(0, nil) }
  }
}

#if os(macOS)
  @MainActor private final class HermesCredentialsValidator: NSObject, NSTextFieldDelegate {
    private weak var email: NSTextField?
    private weak var password: NSSecureTextField?
    private weak var signIn: NSButton?

    init(email: NSTextField, password: NSSecureTextField, signIn: NSButton) {
      self.email = email
      self.password = password
      self.signIn = signIn
    }

    func controlTextDidChange(_: Notification) {
      let address = email?.stringValue.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      signIn?.isEnabled = !address.isEmpty && !(password?.stringValue ?? "").isEmpty
    }
  }
#endif

private final class NoRedirect: NSObject, URLSessionTaskDelegate {
  func urlSession(_: URLSession, task _: URLSessionTask,
                  willPerformHTTPRedirection _: HTTPURLResponse,
                  newRequest _: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void)
  {
    completionHandler(nil)
  }
}
