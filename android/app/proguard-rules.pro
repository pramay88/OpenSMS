# Hilt rules
-keep public class * extends android.app.Service
-keep public class * extends android.app.Application
-keep public class * extends android.app.Activity
-keep public class * extends android.content.BroadcastReceiver
-keep public class * extends android.content.ContentProvider

# Retrofit & OkHttp
-keepattributes Signature, InnerClasses, AnnotationDefault
-dontwarn okhttp3.**
-dontwarn retrofit2.**
-keep class retrofit2.** { *; }

# GSON models
-keep class com.smsgateway.app.data.api.** { *; }
-keepattributes *Annotation*

# Room
-keep class * extends androidx.room.RoomDatabase
-dontwarn androidx.room.paging.**

# Google ErrorProne (Tink/Security-Crypto)
-dontwarn com.google.errorprone.annotations.**
