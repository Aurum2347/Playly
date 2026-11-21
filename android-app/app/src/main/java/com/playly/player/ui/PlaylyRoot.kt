package com.playly.player.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playly.player.data.settings.AccentChoice
import com.playly.player.data.settings.AppSettings
import com.playly.player.data.settings.ListDensity
import com.playly.player.designsystem.PlaylyListStyle
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.ui.screens.onboarding.OnboardingScreen

@Composable
fun PlaylyRoot(appViewModel: AppViewModel = viewModel(factory = AppViewModel.Factory)) {
    val settings by appViewModel.appSettings.collectAsStateWithLifecycle()
    val openLibrary by appViewModel.openLibraryOnce.collectAsStateWithLifecycle()
    val openPlayer by appViewModel.openPlayerRequest.collectAsStateWithLifecycle()
    val systemAnimationsOff = rememberSystemAnimationsDisabled()
    val current = settings

    PlaylyTheme(
        reduceMotion = systemAnimationsOff || current?.reduceMotion == true,
        accent = Color(current?.accent?.argb ?: AccentChoice.Neutral.argb),
        listStyle = PlaylyListStyle(
            compact = current?.listDensity == ListDensity.Compact,
            showArtwork = current?.listArtwork != false,
        ),
    ) {
        Box(Modifier.fillMaxSize().background(PlaylyTheme.colors.background)) {
            // Settings load from disk in a few milliseconds; show only the background meanwhile
            // so onboarding never flashes for returning users.
            if (current != null) RootContent(current, openLibrary, openPlayer, appViewModel)
        }
    }
}

@Composable
private fun RootContent(settings: AppSettings, openLibrary: Boolean, openPlayer: Boolean, appViewModel: AppViewModel) {
    val snackbar = remember { SnackbarHostState() }
    val motion = PlaylyTheme.motion
    CompositionLocalProvider(LocalSnackbarHostState provides snackbar) {
        CollectMessages(appViewModel.playbackMessages)
        AnimatedContent(
            targetState = settings.onboardingCompleted,
            transitionSpec = { fadeIn(motion.enter()) togetherWith fadeOut(motion.exit()) },
            label = "onboarding",
        ) { completed ->
            if (completed) {
                MainScaffold(
                    openLibrary = openLibrary,
                    onLibraryOpened = appViewModel::consumeOpenLibrary,
                    openPlayerRequest = openPlayer,
                    onPlayerRequestHandled = appViewModel::consumeOpenPlayer,
                    openPlayerOnPlay = settings.openPlayerOnPlay,
                )
            } else {
                OnboardingScreen(onFinished = appViewModel::completeOnboarding)
            }
        }
    }
}
