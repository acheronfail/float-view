@testable import FloatViewBackend
import Foundation
import Testing

@Suite("Pinned WebView navigation")
struct ExternalBrowserURLTests {
  private let backend = URL(string: "http://127.0.0.1:11002")!

  @Test(arguments: ["http://127.0.0.1:11002", "http://127.0.0.1:11002/",
                    "http://127.0.0.1:11002/#/settings/licences"])
  func backendAndHashRoutesStayEmbedded(_ value: String) {
    #expect(decision(value, userLink: false) == .allowBackend)
    #expect(decision(value, userLink: true) == .allowBackend)
    #expect(isBackendPage(URL(string: value), backendURL: backend))
    #expect(decision(value, userLink: true, newWindow: true) == .cancel)
    #expect(decision(value, userLink: true, mainFrame: false) == .cancel)
  }

  @Test(arguments: ["https://github.com/acheronfail/float-view/blob/master/PRIVACY.md",
                    "https://github.com/acheronfail/float-view", "http://example.test/help"])
  func externalUserLinksOpenBrowserForEitherTarget(_ value: String) throws {
    let url = try #require(URL(string: value))
    #expect(decision(value, userLink: true) == .openBrowser(url))
    #expect(decision(value, userLink: true, mainFrame: false, newWindow: true) == .openBrowser(url))
    #expect(decision(value, userLink: false) == .cancel)
    #expect(decision(value, userLink: false, newWindow: true) == .cancel)
    #expect(decision(value, userLink: true, mainFrame: false) == .cancel)
    #expect(!isBackendPage(url, backendURL: backend))
  }

  @Test(arguments: ["http://127.0.0.1:11002/other", "http://127.0.0.1:11002/?token=changed",
                    "http://127.0.0.1:11003/", "https://127.0.0.1:11002/", "http://127.0.0.2/",
                    "http://localhost/", "http://app.localhost/", "http://[::1]/",
                    "file:///private/data", "javascript:alert(1)", "about:blank",
                    "mailto:example@example.test", "https://user:password@example.test/"])
  func rejectsOtherDocumentsSchemesAndCredentials(_ value: String) {
    #expect(decision(value, userLink: true) == .cancel)
    #expect(decision(value, userLink: true, newWindow: true) == .cancel)
    #expect(!isBackendPage(URL(string: value), backendURL: backend))
  }

  @Test func missingNavigationContextFailsClosed() {
    #expect(webViewNavigationDecision(nil, backendURL: backend, isUserLink: true,
                                      isMainFrame: true, opensNewWindow: false) == .cancel)
    #expect(webViewNavigationDecision(backend, backendURL: nil, isUserLink: true,
                                      isMainFrame: true, opensNewWindow: false) == .cancel)
    #expect(!isBackendPage(backend, backendURL: nil))
  }

  private func decision(_ value: String, userLink: Bool, mainFrame: Bool = true,
                        newWindow: Bool = false) -> WebViewNavigationDecision
  {
    webViewNavigationDecision(URL(string: value), backendURL: backend, isUserLink: userLink,
                              isMainFrame: mainFrame, opensNewWindow: newWindow)
  }
}
