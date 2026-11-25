package fail.acheron.floatview.ui

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.content.IntentFilter
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import fail.acheron.floatview.lifecycle.FloatViewApplication
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ExternalLinksInstrumentedTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private fun webViews(view: View): List<WebView> = (if (view is WebView) listOf(view) else emptyList()) +
        if (view is ViewGroup) (0 until view.childCount).flatMap { webViews(view.getChildAt(it)) } else emptyList()

    @Test fun privacyLinksUseExternalBrowserForSameWindowAndNewWindow() {
        val app = instrumentation.targetContext.applicationContext as FloatViewApplication
        val activity = instrumentation.startActivitySync(Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        val launched = mutableListOf<Intent>()
        val monitor = object : Instrumentation.ActivityMonitor() {
            override fun onStartActivity(intent: Intent): Instrumentation.ActivityResult? {
                if (intent.action != Intent.ACTION_VIEW) return null
                synchronized(launched) { launched.add(intent) }
                return Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null)
            }
        }
        instrumentation.addMonitor(monitor)
        try {
            var web: WebView? = null
            val deadline = SystemClock.uptimeMillis() + 15_000
            while (SystemClock.uptimeMillis() < deadline) {
                instrumentation.runOnMainSync {
                    web = webViews(activity.findViewById(android.R.id.content)).singleOrNull()?.takeIf { it.progress == 100 && webNavigation(it.url.orEmpty(), app.backend.origin) == WebNavigation.BACKEND }
                }
                if (web != null) break
                SystemClock.sleep(50)
            }
            val current = requireNotNull(web)
            // Use a disposable local document so the app's safety overlay and live
            // frontend updates cannot consume fixture taps. No acknowledgement is saved.
            instrumentation.runOnMainSync {
                current.loadDataWithBaseURL(app.backend.origin, "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body></body></html>", "text/html", "UTF-8", app.backend.origin)
            }
            instrumentation.waitForIdleSync()
            SystemClock.sleep(500)
            for ((index, target) in listOf("_self", "_blank").withIndex()) {
                val latch = CountDownLatch(1)
                var position: JSONObject? = null
                val url = "https://github.com/acheronfail/float-view/blob/master/PRIVACY.md?test=$index"
                instrumentation.runOnMainSync {
                    current.evaluateJavascript("""(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());Array.from(document.body.children).forEach(e=>e.style.display='none');document.getElementById('native-link-test')?.remove();const a=document.createElement('a');a.id='native-link-test';a.href='$url';a.target='$target';a.textContent='Privacy policy';a.style='position:fixed;left:20px;top:60px;width:180px;height:60px;z-index:2147483647;background:white;color:black';document.body.appendChild(a);const r=a.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,width:innerWidth,hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.id});})()""") { result ->
                        position = JSONObject(JSONArray("[$result]").getString(0)); latch.countDown()
                    }
                }
                assertTrue(latch.await(5, TimeUnit.SECONDS))
                instrumentation.waitForIdleSync()
                SystemClock.sleep(200)
                assertEquals("Fixture must receive the tap", "native-link-test", position!!.getString("hit"))
                instrumentation.runOnMainSync { assertTrue("Frontend must be visible", current.isShown) }
                val xy = IntArray(2)
                var scale = 1f
                instrumentation.runOnMainSync { current.getLocationOnScreen(xy); scale = current.width.toFloat() / position!!.getDouble("width").toFloat() }
                val now = SystemClock.uptimeMillis()
                val x = xy[0] + position!!.getDouble("x").toFloat() * scale
                val y = xy[1] + position!!.getDouble("y").toFloat() * scale
                instrumentation.sendPointerSync(MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0))
                instrumentation.sendPointerSync(MotionEvent.obtain(now, now + 50, MotionEvent.ACTION_UP, x, y, 0))
                val timeout = SystemClock.uptimeMillis() + 5_000
                while (SystemClock.uptimeMillis() < timeout && synchronized(launched) { launched.size <= index }) SystemClock.sleep(50)
                assertEquals("External browser launch for $target", url, synchronized(launched) { launched.getOrNull(index)?.dataString })
                instrumentation.runOnMainSync { assertEquals(WebNavigation.BACKEND, webNavigation(current.url.orEmpty(), app.backend.origin)) }
            }
        } finally {
            instrumentation.removeMonitor(monitor)
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
