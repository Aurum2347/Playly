package com.playly.player.ui.screens.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playly.player.R
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.PlaylyButton
import com.playly.player.designsystem.components.PlaylyButtonStyle
import com.playly.player.designsystem.components.PlaylyLogo
import com.playly.player.ui.CollectMessages
import com.playly.player.ui.LocalSnackbarHostState
import com.playly.player.ui.PlaylySnackbar
import com.playly.player.ui.rememberFolderPicker
import com.playly.player.ui.screens.library.LibraryViewModel

/**
 * First launch (spec §4, §15): explain the offline idea and let the user pick the one folder
 * the library is built from. No device-wide permission: the system picker grants that folder only.
 * "Later" never blocks: the empty library offers the same picker.
 */
@Composable
fun OnboardingScreen(
    onFinished: (openLibrary: Boolean) -> Unit,
    viewModel: LibraryViewModel = viewModel(factory = LibraryViewModel.Factory),
) {
    CollectMessages(viewModel.messages)
    val pickFolder = rememberFolderPicker { uri -> viewModel.addSource(uri) { onFinished(true) } }

    Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
        Column(Modifier.fillMaxSize().padding(horizontal = PlaylyTheme.spacing.xl)) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Column(
                    modifier = Modifier.widthIn(max = 420.dp).verticalScroll(rememberScrollState()),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    PlaylyLogo(size = 88.dp)
                    Spacer(Modifier.height(PlaylyTheme.spacing.xl))
                    Text(
                        stringResource(R.string.onboarding_title),
                        style = PlaylyTheme.typography.pageTitle,
                        color = PlaylyTheme.colors.textPrimary,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.semantics { heading() },
                    )
                    Spacer(Modifier.height(PlaylyTheme.spacing.xs))
                    Text(
                        stringResource(R.string.onboarding_subtitle),
                        style = PlaylyTheme.typography.body,
                        color = PlaylyTheme.colors.textMuted,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(PlaylyTheme.spacing.xxl))
                    Column(verticalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm)) {
                        Point(stringResource(R.string.onboarding_point_offline))
                        Point(stringResource(R.string.onboarding_point_account))
                        Point(stringResource(R.string.onboarding_point_device))
                    }
                }
            }
            Column(
                modifier = Modifier.fillMaxWidth().padding(vertical = PlaylyTheme.spacing.md),
                verticalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.xs),
            ) {
                PlaylyButton(
                    text = stringResource(R.string.action_pick_folder),
                    onClick = pickFolder,
                    modifier = Modifier.fillMaxWidth(),
                    icon = R.drawable.ic_folder,
                )
                PlaylyButton(
                    text = stringResource(R.string.action_later),
                    onClick = { onFinished(false) },
                    modifier = Modifier.fillMaxWidth(),
                    style = PlaylyButtonStyle.Text,
                )
            }
        }
        SnackbarHost(LocalSnackbarHostState.current, Modifier.align(Alignment.BottomCenter)) { PlaylySnackbar(it.visuals.message) }
    }
}

@Composable
private fun Point(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).clip(PlaylyTheme.shapes.pill).background(PlaylyTheme.colors.textSecondary))
        Spacer(Modifier.size(PlaylyTheme.spacing.sm))
        Text(text, style = PlaylyTheme.typography.body, color = PlaylyTheme.colors.textSecondary)
    }
}
