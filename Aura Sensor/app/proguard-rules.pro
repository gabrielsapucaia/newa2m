# Keep kotlinx serialization metadata
-keepclassmembers class **$$serializer { *; }
-keepclassmembers class kotlinx.serialization.** { *; }
-keep @kotlinx.serialization.Serializable class *
-keepclassmembers class * {
    @kotlinx.serialization.SerialName <fields>;
}

# Keep Timber stack traces
-keep class timber.log.Timber { *; }
-keep class timber.log.Timber$* { *; }

# Paho MQTT callback interfaces
-keepclassmembers class org.eclipse.paho.client.mqttv3.** { *; }
