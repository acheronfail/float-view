package fail.acheron.floatview.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class WebNavigationPolicyTest {
    private val origin = "http://127.0.0.1:11010"
    @Test fun `bundled document and frontend fragment routes stay local`() {
        for (url in listOf(origin, "$origin/", "$origin/#/settings/licences"))
            assertEquals(WebNavigation.BACKEND, webNavigation(url, origin))
    }
    @Test fun `public privacy source and support links open externally`() {
        for (url in listOf("https://github.com/acheronfail/float-view/blob/master/PRIVACY.md", "https://github.com/acheronfail/float-view/issues", "https://www.openstreetmap.org/copyright"))
            assertEquals(WebNavigation.EXTERNAL, webNavigation(url, origin))
    }
    @Test fun `backend API query wrong ports and non-web schemes cannot become documents`() {
        for (url in listOf("$origin/api/ws", "$origin/?token=secret", "http://127.0.0.1:1234/", "http://localhost/", "file:///private/data", "javascript:alert(1)", "intent://example", "https://user:pass@example.com/", "invalid url"))
            assertEquals(WebNavigation.BLOCK, webNavigation(url, origin))
    }
}
