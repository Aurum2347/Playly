import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.room)
}

// One version for desktop and Android: read it from the repository's package.json.
val playlyVersion: String = run {
    val manifest = rootProject.file("../package.json")
    @Suppress("UNCHECKED_CAST")
    (JsonSlurper().parse(manifest) as Map<String, Any>)["version"] as String
}
val playlyVersionCode: Int = run {
    val (major, minor, patch) = playlyVersion.split(".").map { it.takeWhile(Char::isDigit).toInt() }
    require(minor <= 99 && patch <= 99) { "Version components must fit two digits: $playlyVersion" }
    major * 10000 + minor * 100 + patch
}

android {
    namespace = "com.playly.player"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.playly.player"
        minSdk = 28
        targetSdk = 36
        versionCode = playlyVersionCode
        versionName = playlyVersion
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            // Installs next to the legacy WebView prototype (com.playly.player).
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        // Release code (R8, no debug Compose overhead) signed with the debug key, for performance checks
        // on an emulator/device. Never shipped.
        create("benchmark") {
            initWith(getByName("release"))
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += "release"
            applicationIdSuffix = ".bench"
            versionNameSuffix = "-bench"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    sourceSets {
        // Exported Room schemas feed MigrationTestHelper.
        getByName("androidTest").assets.directories.add("$projectDir/schemas")
    }

    lint {
        abortOnError = true
        warningsAsErrors = false
        checkDependencies = false
    }
}

room {
    schemaDirectory("$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.datastore.preferences)
    // Artwork: memory + disk cache, sized decoding. Only the core is used, no network module.
    implementation(libs.coil.compose)
    // Playback: ExoPlayer for local files (no network data sources are used) and the media session.
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.session)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.guava)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.room.testing)
    androidTestImplementation(libs.kotlinx.coroutines.test)
}
