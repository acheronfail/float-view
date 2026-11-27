import java.security.MessageDigest

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

val rustCoreDirectory = rootProject.file("../core")
val rustRuntimeHelper = rustCoreDirectory.resolve("build-android-runtime.sh")
val rustRuntimePackage = "application-runtime-android-jni"
val rustRuntimeLibraryStem = "float_view_application_runtime_android_jni"
val rustRuntimeProperty = "floatViewApplicationRuntimeJniLibrary"
val rustRuntimeInputs = files(
    rustCoreDirectory.resolve("Cargo.toml"),
    rustCoreDirectory.resolve("Cargo.lock"),
    rootProject.file("../../rust-toolchain.toml"),
    fileTree(rustCoreDirectory) {
        include("**/Cargo.toml", "**/*.rs")
        exclude("target/**")
    },
    rustRuntimeHelper,
)
val hermesRegistrationFingerprint = providers.provider {
    val values = listOf(
        "FLOAT_VIEW_HERMES_ORGANIZATION",
        "FLOAT_VIEW_HERMES_AUTH_API_KEY",
        "FLOAT_VIEW_HERMES_RIDES_API_KEY",
    ).map { providers.environmentVariable(it).orElse("").get() }
    MessageDigest.getInstance("SHA-256")
        .digest(values.joinToString("\u0000").toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}
val rustRuntimeAndroidRoot = rustCoreDirectory.resolve("target/android/applicationRuntimeJniLibs")
val rustRuntimeHostRoot = rustCoreDirectory.resolve("target/android/application-runtime-host/debug")
val rustHostLibraryExtension =
    if (System.getProperty("os.name").lowercase().contains("mac")) "dylib" else "so"
val rustRuntimeHostLibrary =
    rustRuntimeHostRoot.resolve("lib$rustRuntimeLibraryStem.$rustHostLibraryExtension")

fun registerAndroidRustRuntimeBuild(profile: String) = tasks.register<Exec>(
    "buildAndroidRustRuntime${profile.replaceFirstChar(Char::uppercase)}"
) {
    group = "build"
    description = "Builds the unified Android Rust runtime for all four ABIs ($profile)."
    workingDir(rootProject.projectDir)
    commandLine(
        rustRuntimeHelper.absolutePath,
        "android-all",
        profile,
        rustRuntimeAndroidRoot.resolve(profile).absolutePath,
    )
    inputs.files(rustRuntimeInputs)
    inputs.property("hermesRegistrationFingerprint", hermesRegistrationFingerprint)
    outputs.dir(rustRuntimeAndroidRoot.resolve(profile))
}

val rustRuntimeDebug = registerAndroidRustRuntimeBuild("debug")
val rustRuntimeRelease = registerAndroidRustRuntimeBuild("release")
val rustRuntimeHost = tasks.register<Exec>("buildAndroidRustRuntimeHost") {
    group = "verification"
    description = "Builds the unified Rust runtime library used by JVM tests."
    workingDir(rootProject.projectDir)
    commandLine(
        rustRuntimeHelper.absolutePath,
        "host",
        "debug",
        rustRuntimeHostRoot.absolutePath,
    )
    inputs.files(rustRuntimeInputs)
    inputs.property("hermesRegistrationFingerprint", hermesRegistrationFingerprint)
    outputs.file(rustRuntimeHostLibrary)
}

val cleanAndroidRust by tasks.registering(Delete::class) {
    group = "build"
    description = "Deletes generated host and Android Rust runtime outputs."
    delete(rustCoreDirectory.resolve("target/android"))
}

tasks.named("clean") { dependsOn(cleanAndroidRust) }
listOf(rustRuntimeDebug, rustRuntimeRelease, rustRuntimeHost).forEach { provider ->
    provider.configure { mustRunAfter(tasks.named("clean")) }
}

val auditAndroidRustRuntimeTasks by tasks.registering {
    group = "verification"
    description = "Audits the closed Android Rust runtime build surface."
    doLast {
        val expected = setOf(
            "buildAndroidRustRuntimeDebug",
            "buildAndroidRustRuntimeRelease",
            "buildAndroidRustRuntimeHost",
        )
        val actual = tasks.names.filter { it.startsWith("buildAndroidRust") }.toSet()
        require(actual == expected) { "Android Rust task surface drifted: expected=$expected actual=$actual" }
    }
}

val releaseVersion = providers.environmentVariable("FLOAT_VIEW_VERSION").orNull
require(releaseVersion == null || Regex("v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-nightly\\.(0|[1-9][0-9]*)\\.g[0-9a-f]{7,40}|-rc\\.[1-9][0-9]*)?").matches(releaseVersion)) {
    "FLOAT_VIEW_VERSION must be a stable, candidate or nightly app version"
}

val releaseBuildNumber = providers.environmentVariable("FLOAT_VIEW_BUILD_NUMBER").orNull
require(releaseVersion == null || (releaseBuildNumber?.matches(Regex("[1-9][0-9]*")) == true &&
    (releaseBuildNumber?.toLongOrNull() ?: 0L) in 1L..2_100_000_000L)) {
    "Versioned builds require FLOAT_VIEW_BUILD_NUMBER in 1..2100000000"
}

android {
    namespace = "fail.acheron.floatview"
    compileSdk = 36
    ndkVersion = "28.2.13676358"

    defaultConfig {
        applicationId = "fail.acheron.floatview"
        minSdk = 29
        targetSdk = 36
        versionCode = if (releaseVersion != null) releaseBuildNumber!!.toInt() else 1
        versionName = releaseVersion?.removePrefix("v") ?: "0.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk {
            abiFilters += setOf("arm64-v8a", "armeabi-v7a", "x86", "x86_64")
        }
    }

    buildTypes {
        create("conformance") {
            initWith(getByName("debug"))
            matchingFallbacks += listOf("debug")
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    sourceSets {
        getByName("main").assets.srcDir("../../../frontend/build")
        getByName("conformance").jniLibs.srcDir(rustRuntimeAndroidRoot.resolve("debug"))
        getByName("debug").java.srcDir("src/ordinary/java")
        getByName("release").java.srcDir("src/ordinary/java")
        getByName("debug").jniLibs.srcDir(rustRuntimeAndroidRoot.resolve("debug"))
        getByName("release").jniLibs.srcDir(rustRuntimeAndroidRoot.resolve("release"))
    }
    testOptions {
        unitTests.all {
            it.dependsOn(rustRuntimeHost)
            it.systemProperty(rustRuntimeProperty, rustRuntimeHostLibrary.absolutePath)
        }
    }
}

tasks.configureEach {
    when (name) {
        "mergeConformanceJniLibFolders" -> dependsOn(rustRuntimeDebug)
        "mergeDebugJniLibFolders" -> dependsOn(rustRuntimeDebug)
        "mergeReleaseJniLibFolders" -> dependsOn(rustRuntimeRelease)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.coroutines.core)
    testImplementation(libs.junit)
    testImplementation("org.json:json:20240303")
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.test.runner)
}
