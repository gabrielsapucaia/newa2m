import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val properties = Properties().apply {
    val defaults = rootProject.file("local.defaults.properties")
    if (defaults.exists()) {
        defaults.inputStream().use { load(it) }
    }
    val locals = rootProject.file("local.properties")
    if (locals.exists()) {
        locals.inputStream().use { load(it) }
    }
}

fun propertyOrDefault(key: String, default: String = ""): String =
    properties.getProperty(key, default)

android {
    namespace = "com.example.sensorlogger"
    compileSdk = 34
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "com.example.sensorlogger"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true

        val mqttScheme = propertyOrDefault("MQTT_SCHEME", "tcp")
        val configuredMqttHost = propertyOrDefault("MQTT_HOST", "127.0.0.1")
        val mqttPort = propertyOrDefault("MQTT_PORT", "1883")
        val mqttUsername = propertyOrDefault("MQTT_USERNAME")
        val mqttPassword = propertyOrDefault("MQTT_PASSWORD")
        val mqttTopicBase = propertyOrDefault("MQTT_TOPIC_BASE", "telemetry")
        val mqttTopicStatus = propertyOrDefault("MQTT_TOPIC_STATUS", "status")
        val mqttTopicLast = propertyOrDefault("MQTT_TOPIC_LAST", "last")
        val deviceId = propertyOrDefault("DEVICE_ID", "sensorlogger-device")
        val operatorsEndpoint = propertyOrDefault("OPERATORS_ENDPOINT", "https://example.com/operators")
        val mqttDiscoveryPrefix = propertyOrDefault("MQTT_DISCOVERY_PREFIX", "")
        val mqttDiscoveryRange = propertyOrDefault("MQTT_DISCOVERY_RANGE", "")
        val mqttDiscoveryTimeoutRaw = propertyOrDefault("MQTT_DISCOVERY_TIMEOUT_MS", "300")
        val mqttDiscoveryTimeout = mqttDiscoveryTimeoutRaw.toIntOrNull()?.coerceAtLeast(100) ?: 300

        val mqttAdditionalHostsRaw = propertyOrDefault("MQTT_ADDITIONAL_HOSTS", "")
        val mqttAdditionalHosts = mqttAdditionalHostsRaw.split(',')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        val mqttHostCandidates = (sequenceOf(configuredMqttHost) + mqttAdditionalHosts.asSequence())
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
            .toList()
        val mqttPrimaryHost = mqttHostCandidates.firstOrNull().orEmpty()
        val mqttServerUris = mqttHostCandidates.joinToString(";") { "$mqttScheme://$it:$mqttPort" }
        val mqttUrl = if (mqttPrimaryHost.isNotEmpty()) "$mqttScheme://$mqttPrimaryHost:$mqttPort" else ""

        buildConfigField("String", "MQTT_SCHEME", "\"$mqttScheme\"")
        buildConfigField("String", "MQTT_HOST", "\"$mqttPrimaryHost\"")
        buildConfigField("int", "MQTT_PORT", mqttPort)
        buildConfigField("String", "MQTT_USERNAME", "\"$mqttUsername\"")
        buildConfigField("String", "MQTT_PASSWORD", "\"$mqttPassword\"")
        buildConfigField("String", "MQTT_TOPIC_BASE", "\"$mqttTopicBase\"")
        buildConfigField("String", "MQTT_TOPIC_STATUS", "\"$mqttTopicStatus\"")
        buildConfigField("String", "MQTT_TOPIC_LAST", "\"$mqttTopicLast\"")
        buildConfigField("String", "DEVICE_ID", "\"$deviceId\"")
        buildConfigField("String", "MQTT_URL", "\"$mqttUrl\"")
        buildConfigField("String", "MQTT_ADDITIONAL_HOSTS", "\"${mqttAdditionalHosts.joinToString(",")}\"")
        buildConfigField("String", "MQTT_SERVER_URIS", "\"$mqttServerUris\"")
        buildConfigField("String", "MQTT_DISCOVERY_PREFIX", "\"$mqttDiscoveryPrefix\"")
        buildConfigField("String", "MQTT_DISCOVERY_RANGE", "\"$mqttDiscoveryRange\"")
        buildConfigField("int", "MQTT_DISCOVERY_TIMEOUT_MS", mqttDiscoveryTimeout.toString())
        buildConfigField("String", "OPERATORS_ENDPOINT", "\"$operatorsEndpoint\"")
    }

    buildTypes {
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

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf(
            "META-INF/LICENSE.md",
            "META-INF/LICENSE-notice.md"
        )
    }

    lint {
        abortOnError = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")

    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-service:2.8.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.4")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("org.eclipse.paho:org.eclipse.paho.client.mqttv3:1.2.5")

    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    implementation("com.jakewharton.timber:timber:5.0.1")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
