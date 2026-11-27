package fail.acheron.floatview.application

import java.nio.file.Files
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RustApplicationRuntimeTest {
    private fun withService(action: (Long) -> Unit) {
        RustApplicationRuntime.ensureLoaded()
        val root = Files.createTempDirectory("float-view-linked-jni").toFile().canonicalFile
        val handle = RustApplicationRuntime.serviceCreate(root.path.toByteArray())
        assertTrue(handle > 0)
        try { action(handle) } finally {
            assertEquals(0, RustApplicationRuntime.serviceDestroy(handle))
            root.deleteRecursively()
        }
    }
    @Test fun retryableCopyAndClosedEnvelope() = withService { handle ->
        val command = "{\"command\":\"drain\"}".toByteArray()
        val required = IntArray(1)
        assertEquals(0, RustApplicationRuntime.serviceApply(handle, command, required))
        assertTrue(required[0] > 0)
        assertEquals(5, RustApplicationRuntime.serviceApply(handle, command, IntArray(1)))
        val written = IntArray(1)
        assertEquals(6, RustApplicationRuntime.serviceCopyResult(handle, ByteArray(0), written))
        assertEquals(required[0], written[0])
        val output = ByteArray(written[0])
        assertEquals(0, RustApplicationRuntime.serviceCopyResult(handle, output, written))
        val result = JSONObject(String(output))
        assertTrue(result.getLong("lifetime") > 0)
        assertEquals("host_state", result.getJSONArray("effects").getJSONObject(0).getString("effect"))
        assertEquals(3, RustApplicationRuntime.serviceApply(handle, "{\"command\":\"drain\",\"extra\":1}".toByteArray(), required))
        assertEquals(1, RustApplicationRuntime.serviceApply(handle, null, required))
        assertEquals(1, RustApplicationRuntime.serviceApply(handle, command, IntArray(2)))
        assertEquals(1, RustApplicationRuntime.serviceApply(handle, ByteArray(1048577), required))
        assertEquals(2, RustApplicationRuntime.serviceApply(Long.MAX_VALUE, command, required))
    }
    @Test fun optionalSpeedObservationCrossesTheNativeBoundaryWithoutStartingCapture() = withService { handle ->
        fun exchange(input: String): JSONObject {
            val required = IntArray(1)
            assertEquals(0, RustApplicationRuntime.serviceApply(handle, input.toByteArray(), required))
            val output = ByteArray(required[0])
            assertEquals(0, RustApplicationRuntime.serviceCopyResult(handle, output, required))
            return JSONObject(String(output))
        }
        val initial = exchange("""{"command":"drain"}""")
        val lifetime = initial.getLong("lifetime")
        val result = exchange("""{"command":"fact","envelope":{"lifetime":$lifetime,"sequence":1,"monotonic_ms":1,"epoch_ms":1700000000001,"fact":{"fact":"location_speed","capture_id":123,"speed_mps":5.0,"accuracy_mps":null,"age_ms":200}}}""")
        assertEquals(0, result.getJSONArray("effects").length())
        val missing = LocationProviderObservation(java.time.Instant.EPOCH, 1.0, 2.0, null)
        assertNull(missing.altitudeM)
        assertNull(missing.speedMps)
        assertNull(missing.speedAccuracyMps)
        assertNull(missing.speedAgeMs)
        val location = exchange("""{"command":"fact","envelope":{"lifetime":$lifetime,"sequence":2,"monotonic_ms":2,"epoch_ms":1700000000002,"fact":{"fact":"location","capture_id":123,"latitude":1.0,"longitude":2.0,"accuracy_m":null,"altitude_m":-12.0,"observed_at_ms":1700000000002}}}""")
        assertEquals(0, location.getJSONArray("effects").length())
    }
    @Test fun listenerBorrowsServiceAndDestructionInvalidatesHandle() = withService { handle ->
        val server = RustApplicationRuntime.serviceServerCreate(handle, 2, "<html/>".toByteArray())
        assertTrue(server > 0)
        val input = "{\"version\":1,\"action\":{\"command\":\"stop\"}}".toByteArray()
        val output = ByteArray(1048576)
        val written = IntArray(1)
        assertEquals(1, RustApplicationRuntime.serverCommand(server, input, ByteArray(1), written))
        assertEquals(0, RustApplicationRuntime.serverCommand(server, input, output, written))
        assertEquals(0, RustApplicationRuntime.serverDestroy(server))
        assertEquals(0, RustApplicationRuntime.serverDestroy(server))
        assertEquals(2, RustApplicationRuntime.serverCommand(server, input, output, written))
        assertEquals(0, RustApplicationRuntime.serviceApply(handle, "{\"command\":\"drain\"}".toByteArray(), written))
        assertEquals(0, RustApplicationRuntime.serviceCopyResult(handle, output, written))
    }
    @Test fun listenersUseIndependentlyAssignedPorts() = withService { handle ->
        val first = RustApplicationRuntime.serviceServerCreate(handle, 2, "<html/>".toByteArray())
        val second = RustApplicationRuntime.serviceServerCreate(handle, 2, "<html/>".toByteArray())
        fun start(server: Long): JSONObject {
            val input = """{"version":1,"action":{"command":"start","parameters":{"platform":"android","port":0}}}""".toByteArray()
            val output = ByteArray(1048576)
            val written = IntArray(1)
            assertEquals(0, RustApplicationRuntime.serverCommand(server, input, output, written))
            return JSONObject(String(output, 0, written[0], Charsets.UTF_8)).getJSONObject("data")
        }
        try {
            val a = start(first)
            val b = start(second)
            assertTrue(a.getInt("port") in 1..65535)
            assertTrue(b.getInt("port") in 1..65535)
            assertNotEquals(a.getInt("port"), b.getInt("port"))
            assertNotEquals(a.getString("token"), b.getString("token"))
        } finally {
            assertEquals(0, RustApplicationRuntime.serverDestroy(first))
            assertEquals(0, RustApplicationRuntime.serverDestroy(second))
        }
    }

}
