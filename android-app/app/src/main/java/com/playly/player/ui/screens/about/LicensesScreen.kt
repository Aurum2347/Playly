package com.playly.player.ui.screens.about

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.playly.player.R
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.PlaylyTopBar
import com.playly.player.designsystem.components.RowDivider
import com.playly.player.designsystem.components.SettingsGroup
import com.playly.player.designsystem.components.SettingsRow

/** A library in the APK; all of them are Apache 2.0 (checked against gradle/libs.versions.toml). */
private data class Library(val name: String, val owner: String, val site: String)

private val LIBRARIES = listOf(
    Library("Jetpack Compose, Material 3", "Google / AOSP", "developer.android.com/jetpack/compose"),
    Library("AndroidX Core, Activity, Lifecycle, Navigation", "Google / AOSP", "developer.android.com/jetpack/androidx"),
    Library("AndroidX Room", "Google / AOSP", "developer.android.com/training/data-storage/room"),
    Library("AndroidX DataStore", "Google / AOSP", "developer.android.com/topic/libraries/architecture/datastore"),
    Library("AndroidX Media3 (ExoPlayer, Session)", "Google / AOSP", "github.com/androidx/media"),
    Library("Coil", "Coil Contributors", "github.com/coil-kt/coil"),
    Library("Kotlin, kotlinx.coroutines, kotlinx.serialization", "JetBrains", "kotlinlang.org"),
    Library("Guava", "Google", "github.com/google/guava"),
)

/** Stage 9.3: open-source libraries (Settings → About). No network: plain text only. */
@Composable
fun LicensesScreen(onBack: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        PlaylyTopBar(title = stringResource(R.string.settings_licenses_title), onBack = onBack)
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(vertical = PlaylyTheme.spacing.md),
            verticalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.md),
        ) {
            item(key = "intro") {
                Text(
                    stringResource(R.string.licenses_intro),
                    style = PlaylyTheme.typography.subtitle,
                    color = PlaylyTheme.colors.textMuted,
                    modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.page),
                )
            }
            item(key = "list") {
                SettingsGroup {
                    LIBRARIES.forEachIndexed { index, library ->
                        if (index > 0) RowDivider()
                        SettingsRow(title = library.name, subtitle = library.owner + " · " + library.site + " · Apache 2.0")
                    }
                }
            }
            item(key = "nav-inset") { Column(Modifier.navigationBarsPadding()) {} }
        }
    }
}
