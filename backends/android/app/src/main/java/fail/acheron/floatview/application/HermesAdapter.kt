package fail.acheron.floatview.application

import android.app.AlertDialog
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.text.InputType
import android.util.AtomicFile
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import androidx.core.widget.doAfterTextChanged
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Native UI, credential storage and transport for the process-owned Hermes integration. */
internal class HermesAdapter(
    context: Context,
    private val foreground: () -> android.app.Activity?,
) {
    private val main = Handler(Looper.getMainLooper())
    private val worker = ThreadPoolExecutor(1, 1, 15, TimeUnit.SECONDS, ArrayBlockingQueue(2)).apply {
        allowCoreThreadTimeOut(true)
    }
    private val credential = AtomicFile(File(context.noBackupFilesDir, "ride-hermes-account"))
    private val alias = "float-view-ride-hermes"

    fun handle(action: String, data: String?, done: (Int, String?) -> Unit) {
        if (action == "prompt") {
            main.post { prompt(done) }
            return
        }
        try {
            worker.execute {
                val outcome = runCatching {
                    when (action) {
                        "read" -> 200 to read()
                        "store" -> { store(requireNotNull(data)); 200 to null }
                        "clear" -> {
                            keyStore().deleteEntry(alias)
                            credential.delete()
                            200 to null
                        }
                        "request" -> request(JSONObject(requireNotNull(data)))
                        else -> 0 to null
                    }
                }.getOrElse { 0 to null }
                done(outcome.first, outcome.second)
            }
        } catch (_: RejectedExecutionException) {
            done(0, null)
        }
    }

    fun close() { worker.shutdownNow() }

    private fun prompt(done: (Int, String?) -> Unit) {
        val activity = foreground()?.takeUnless { it.isFinishing || it.isDestroyed || !it.hasWindowFocus() }
        if (activity == null) { done(0, null); return }
        val email = EditText(activity).apply {
            id = View.generateViewId()
            hint = "Email address"
            imeOptions = EditorInfo.IME_ACTION_NEXT
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            isSingleLine = true
        }
        val password = EditText(activity).apply {
            id = View.generateViewId()
            hint = "Password"
            imeOptions = EditorInfo.IME_ACTION_DONE
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            isSingleLine = true
        }
        email.nextFocusForwardId = password.id
        val fields = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            val padding = (24 * resources.displayMetrics.density).toInt()
            setPadding(padding, 0, padding, 0)
            addView(email)
            addView(password)
        }
        var submitted = false
        AlertDialog.Builder(activity)
            .setTitle("Sign in to Ride Hermes")
            .setMessage("Use your Ride Hermes account to upload rides from Float View.")
            .setView(fields)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Sign in") { _, _ ->
                submitted = true
                val data = json("email" to email.text.toString(), "password" to password.text.toString()).toString()
                password.text.clear()
                done(200, data)
            }
            .create().also { dialog ->
                dialog.setOnDismissListener {
                    password.text.clear()
                    if (!submitted) done(204, null)
                }
                dialog.show()
                val signIn = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                fun updateButton() {
                    signIn.isEnabled = email.text.isNotBlank() && password.text.isNotEmpty()
                }
                email.doAfterTextChanged { updateButton() }
                password.doAfterTextChanged { updateButton() }
                password.setOnEditorActionListener { _, action, _ ->
                    if (action != EditorInfo.IME_ACTION_DONE) false
                    else {
                        if (signIn.isEnabled) signIn.performClick()
                        true
                    }
                }
                updateButton()
                email.requestFocus()
            }
    }

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun key(create: Boolean): SecretKey {
        val existing = keyStore().getKey(alias, null) as? SecretKey
        if (existing != null) return existing
        check(create)
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
            generateKey()
        }
    }

    private fun read(): String? {
        if (!credential.baseFile.exists()) return null
        val value = credential.openRead().use { stream ->
            stream.readBounded(4097).also { check(it.size in 29..4096) }
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, value, 0, 12))
        return cipher.doFinal(value, 12, value.size - 12).toString(Charsets.UTF_8)
    }

    private fun store(value: String) {
        val bytes = value.toByteArray(Charsets.UTF_8)
        check(bytes.size <= 4068)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(true))
        check(cipher.iv.size == 12)
        val stream = credential.startWrite()
        try {
            stream.write(cipher.iv)
            stream.write(cipher.doFinal(bytes))
            credential.finishWrite(stream)
        } catch (error: Exception) {
            credential.failWrite(stream)
            throw error
        }
    }

    private fun InputStream.readBounded(limit: Int): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        while (output.size() < limit) {
            val count = read(buffer, 0, minOf(buffer.size, limit - output.size()))
            if (count <= 0) break
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun request(value: JSONObject): Pair<Int, String?> {
        val route = value.getString("route")
        check(route == "auth" || route == "rides")
        val body = value.getString("body").toByteArray(Charsets.UTF_8)
        check(body.size <= 384 * 1024)
        val connection = URL("https://ridehermes.app/api/developer/v0/$route").openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 12_000
            connection.readTimeout = 12_000
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setFixedLengthStreamingMode(body.size)
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("organization", value.getString("organization"))
            connection.setRequestProperty("api_key", value.getString("api_key"))
            if (!value.isNull("token")) connection.setRequestProperty("auth_token", value.getString("token"))
            connection.outputStream.use { it.write(body) }
            val status = connection.responseCode
            if (status !in 200..299) return status to null
            val response = connection.inputStream.use { it.readBounded(32769) }
            return status to if (response.size <= 32768) response.toString(Charsets.UTF_8) else null
        } finally {
            connection.disconnect()
        }
    }
}
