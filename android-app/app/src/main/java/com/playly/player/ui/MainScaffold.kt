package com.playly.player.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.dropUnlessResumed
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import androidx.navigation.NavDestination
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.navigation
import androidx.navigation.compose.rememberNavController
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.PlaylyIcon
import com.playly.player.ui.actions.LocalTrackActions
import com.playly.player.ui.actions.TrackActionsHost
import com.playly.player.ui.actions.TrackActionsViewModel
import com.playly.player.ui.navigation.HomeGraph
import com.playly.player.ui.navigation.HomeRoute
import com.playly.player.ui.navigation.RecentRoute
import com.playly.player.ui.navigation.LibraryRoute
import com.playly.player.ui.navigation.AddTracksRoute
import com.playly.player.ui.navigation.FavoritesRoute
import com.playly.player.ui.navigation.DuplicatesRoute
import com.playly.player.ui.navigation.ErrorLogRoute
import com.playly.player.ui.navigation.LicensesRoute
import com.playly.player.ui.screens.about.ErrorLogScreen
import com.playly.player.ui.screens.about.LicensesScreen
import com.playly.player.ui.screens.duplicates.DuplicatesScreen
import com.playly.player.ui.navigation.CollectionRoute
import com.playly.player.ui.screens.collections.CollectionScreen
import com.playly.player.ui.screens.favorites.FavoritesScreen
import com.playly.player.data.library.browse.CollectionKind
import androidx.navigation.toRoute
import com.playly.player.ui.navigation.PlaylistRoute
import com.playly.player.ui.navigation.PlaylistsRoute
import com.playly.player.ui.navigation.SearchRoute
import com.playly.player.ui.navigation.SettingsRoute
import com.playly.player.ui.navigation.TopLevelDestination
import com.playly.player.ui.screens.library.HomeScreen
import com.playly.player.ui.player.MiniPlayer
import com.playly.player.ui.player.MiniPlayerRules
import com.playly.player.ui.player.LocalPlayerLauncher
import com.playly.player.ui.player.PlayerLauncher
import com.playly.player.ui.player.PlayerOverlay
import com.playly.player.ui.player.PlayerViewModel
import com.playly.player.ui.screens.library.LibraryScreen
import com.playly.player.ui.screens.library.RecentScreen
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import com.playly.player.ui.screens.playlists.AddTracksScreen
import com.playly.player.ui.screens.playlists.PlaylistScreen
import com.playly.player.ui.screens.playlists.PlaylistsScreen
import com.playly.player.ui.screens.search.SearchScreen
import com.playly.player.ui.screens.settings.SettingsScreen

/**
 * Bottom navigation shell with the full-screen player layered on top. While a track is current
 * the mini-player sits above the bottom navigation on every page (spec §9); the player opens
 * from it, from the notification ([openPlayerRequest]) or, if the user wants, whenever a track starts.
 */
@Composable
fun MainScaffold(
    openLibrary: Boolean,
    onLibraryOpened: () -> Unit,
    openPlayerRequest: Boolean,
    onPlayerRequestHandled: () -> Unit,
    openPlayerOnPlay: Boolean,
) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val destination = entry?.destination
    val onTopLevel = TopLevelDestination.entries.any { destination.isIn(it) }
    val motion = PlaylyTheme.motion

    val playerViewModel: PlayerViewModel = viewModel(factory = PlayerViewModel.Factory)
    // Activity-scoped: an open track sheet survives rotation and tab switches.
    val trackActions: TrackActionsViewModel = viewModel(factory = TrackActionsViewModel.Factory)
    val badgeState = playerViewModel.badge.collectAsStateWithLifecycle()
    val badge by badgeState
    val launcher = rememberSaveable(saver = PlayerLauncher.Saver) { PlayerLauncher() }
    SideEffect { launcher.openOnPlay = openPlayerOnPlay }
    val playerVisible = launcher.isOpen && badge != null
    val miniVisible = badge != null

    LaunchedEffect(openPlayerRequest) {
        if (!openPlayerRequest) return@LaunchedEffect
        // From the notification. On a cold start the session needs a moment to report its track;
        // if none arrives, drop the request instead of popping the player up later.
        val ready = withTimeoutOrNull(PLAYER_REQUEST_TIMEOUT_MS) { snapshotFlow { badgeState.value != null }.first { it } }
        if (ready != null) launcher.open()
        onPlayerRequestHandled()
    }

    LaunchedEffect(openLibrary) {
        if (openLibrary) {
            nav.navigateToTopLevel(TopLevelDestination.Library)
            onLibraryOpened()
        }
    }

    val openSettings = dropUnlessResumed { nav.navigate(SettingsRoute) { launchSingleTop = true } }
    val openSearch = dropUnlessResumed { nav.navigateToTopLevel(TopLevelDestination.Search) }
    val openRecent = dropUnlessResumed { nav.navigate(RecentRoute) { launchSingleTop = true } }
    val openFavorites = dropUnlessResumed { nav.navigate(FavoritesRoute) { launchSingleTop = true } }
    val openDuplicates = dropUnlessResumed { nav.navigate(DuplicatesRoute) { launchSingleTop = true } }
    val openErrorLog = dropUnlessResumed { nav.navigate(ErrorLogRoute) { launchSingleTop = true } }
    val openLicenses = dropUnlessResumed { nav.navigate(LicensesRoute) { launchSingleTop = true } }
    val goBack = dropUnlessResumed { nav.popBackStack() }
    val openPlaylist: (Long) -> Unit = { id ->
        // Same guard as dropUnlessResumed: a second tap during the transition does nothing.
        if (nav.currentBackStackEntry?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true) {
            nav.navigate(PlaylistRoute(id)) { launchSingleTop = true }
        }
    }
    val openAddTracks: (Long) -> Unit = { id ->
        if (nav.currentBackStackEntry?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true) {
            nav.navigate(AddTracksRoute(id)) { launchSingleTop = true }
        }
    }

    val openCollection: (CollectionKind, String) -> Unit = { kind, key ->
        val route = CollectionRoute(kind.name, key)
        val current = nav.currentBackStackEntry
        val alreadyHere = current?.destination?.hasRoute(CollectionRoute::class) == true && current.toRoute<CollectionRoute>() == route
        // From the player's menu: close it so the page is visible.
        launcher.close()
        if (!alreadyHere && current?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true) nav.navigate(route)
    }

    CompositionLocalProvider(
        LocalPlayerLauncher provides launcher,
        LocalTrackActions provides trackActions,
    ) {
        Box(Modifier.fillMaxSize()) {
            Column(
                Modifier
                    .fillMaxSize()
                    // Under the open player the tabs are hidden from TalkBack, not only from sight.
                    .then(if (playerVisible) Modifier.clearAndSetSemantics { } else Modifier),
            ) {
                NavHost(
                    navController = nav,
                    startDestination = HomeGraph,
                    // Pages end above the mini-player; on pages without the bottom bar the
                    // mini-player takes the navigation-bar inset instead of the page.
                    modifier = Modifier
                        .weight(1f)
                        .then(if (miniVisible) Modifier.consumeWindowInsets(WindowInsets.navigationBars) else Modifier),
                    enterTransition = { fadeIn(motion.enter()) },
                    exitTransition = { fadeOut(motion.exit()) },
                    popEnterTransition = { fadeIn(motion.enter()) },
                    popExitTransition = { fadeOut(motion.exit()) },
                ) {
                    navigation<HomeGraph>(startDestination = HomeRoute) {
                        composable<HomeRoute> {
                            HomeScreen(onOpenSearch = openSearch, onOpenSettings = openSettings, onOpenRecent = openRecent)
                        }
                        composable<RecentRoute>(
                            enterTransition = { slideInHorizontally(motion.enter()) { it / 4 } + fadeIn(motion.enter()) },
                            popExitTransition = { slideOutHorizontally(motion.exit()) { it / 4 } + fadeOut(motion.exit()) },
                        ) { RecentScreen(onBack = goBack) }
                    }
                    composable<LibraryRoute> {
                        LibraryScreen(onOpenSettings = openSettings, onOpenCollection = openCollection, onOpenDuplicates = openDuplicates)
                    }
                    composable<DuplicatesRoute>(
                        enterTransition = { slideInHorizontally(motion.enter()) { it / 4 } + fadeIn(motion.enter()) },
                        popExitTransition = { slideOutHorizontally(motion.exit()) { it / 4 } + fadeOut(motion.exit()) },
                    ) { DuplicatesScreen(onBack = goBack) }
                    composable<PlaylistsRoute> { PlaylistsScreen(onOpenPlaylist = openPlaylist, onOpenFavorites = openFavorites) }
                    composable<FavoritesRoute>(
                        enterTransition = { slideInHorizontally(motion.enter()) { it / 4 } + fadeIn(motion.enter()) },
                        popExitTransition = { slideOutHorizontally(motion.exit()) { it / 4 } + fadeOut(motion.exit()) },
                    ) { FavoritesScreen(onBack = goBack) }
                    composable<PlaylistRoute>(
                        enterTransition = { slideInHorizontally(motion.enter()) { it / 4 } + fadeIn(motion.enter()) },
                        popExitTransition = { slideOutHorizontally(motion.exit()) { it / 4 } + fadeOut(motion.exit()) },
                    ) { PlaylistScreen(onBack = goBack, onAddTracks = openAddTracks) }
                    composable<AddTracksRoute>(
                        enterTransition = { slideInHorizontally(motion.enter()) { it / 4 } + fadeIn(motion.enter()) },
                        popExitTransition = { slideOutHorizontally(motion.exit()) { it / 4 } + fadeOut(motion.exit()) },
                    ) { AddTracksScreen(onBack = goBack) }
                    composable<SearchRoute> {
                        SearchScreen(onBack = goBack, onOpenPlaylist = openPlaylist, onOpenCollection = openCollection)
                    }
                    composable<CollectionRoute>(
                        enterTransition = { slideInHorizontally(motion.enter()) { it / 4 } + fadeIn(motion.enter()) },
                        popExitTransition = { slideOutHorizontally(motion.exit()) { it / 4 } + fadeOut(motion.exit()) },
                    ) { CollectionScreen(onBack = goBack, onOpenCollection = openCollection) }
                    composable<SettingsRoute>(
                        enterTransition = { slideInHorizontally(motion.enter()) { it / 4 } + fadeIn(motion.enter()) },
                        popExitTransition = { slideOutHorizontally(motion.exit()) { it / 4 } + fadeOut(motion.exit()) },
                    ) { SettingsScreen(onBack = goBack, onOpenErrorLog = openErrorLog, onOpenLicenses = openLicenses) }
                    composable<ErrorLogRoute>(
                        enterTransition = { slideInHorizontally(motion.enter()) { it / 4 } + fadeIn(motion.enter()) },
                        popExitTransition = { slideOutHorizontally(motion.exit()) { it / 4 } + fadeOut(motion.exit()) },
                    ) { ErrorLogScreen(onBack = goBack) }
                    composable<LicensesRoute>(
                        enterTransition = { slideInHorizontally(motion.enter()) { it / 4 } + fadeIn(motion.enter()) },
                        popExitTransition = { slideOutHorizontally(motion.exit()) { it / 4 } + fadeOut(motion.exit()) },
                    ) { LicensesScreen(onBack = goBack) }
                }
                AnimatedVisibility(
                    visible = miniVisible,
                    enter = expandVertically(motion.standard()) + fadeIn(motion.enter()),
                    exit = shrinkVertically(motion.standard()) + fadeOut(motion.exit()),
                ) {
                    MiniPlayer(
                        playerViewModel,
                        launcher,
                        Modifier.then(if (onTopLevel) Modifier else Modifier.windowInsetsPadding(WindowInsets.navigationBars)),
                    )
                }
                AnimatedVisibility(
                    visible = onTopLevel,
                    enter = expandVertically(motion.standard()),
                    exit = shrinkVertically(motion.standard()),
                ) {
                    PlaylyBottomBar(current = destination, onSelect = { nav.navigateToTopLevel(it) })
                }
            }
            PlayerOverlay(launcher, playerViewModel)
            TrackActionsHost(trackActions, onOpenCollection = openCollection)
            SnackbarHost(
                hostState = LocalSnackbarHostState.current,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .windowInsetsPadding(WindowInsets.navigationBars)
                    .padding(bottom = if (playerVisible) 0.dp else snackbarLift(onTopLevel, miniVisible)),
            ) { data -> PlaylySnackbar(data.visuals.message, data.visuals.actionLabel, data::performAction) }
        }
    }
}

private const val PLAYER_REQUEST_TIMEOUT_MS = 5_000L

/** Snackbars show above the bottom bar and the mini-player (spec §9). */
@Composable
private fun snackbarLift(onTopLevel: Boolean, miniVisible: Boolean) =
    (if (onTopLevel) PlaylyTheme.spacing.bottomBarHeight else 0.dp) +
        (if (miniVisible) MiniPlayerRules.HEIGHT + MiniPlayerRules.PROGRESS else 0.dp)

@Composable
fun PlaylySnackbar(message: String, actionLabel: String? = null, onAction: () -> Unit = {}) {
    Snackbar(
        modifier = Modifier.padding(PlaylyTheme.spacing.md),
        containerColor = PlaylyTheme.colors.surfaceOverlay,
        contentColor = PlaylyTheme.colors.textPrimary,
        shape = PlaylyTheme.shapes.medium,
        action = actionLabel?.let { label ->
            {
                TextButton(onClick = onAction) {
                    Text(label, style = PlaylyTheme.typography.button, color = PlaylyTheme.colors.textPrimary)
                }
            }
        },
    ) { Text(message, style = PlaylyTheme.typography.subtitle) }
}

@Composable
private fun PlaylyBottomBar(current: NavDestination?, onSelect: (TopLevelDestination) -> Unit) {
    val colors = PlaylyTheme.colors
    Column(Modifier.fillMaxWidth().background(colors.background)) {
        Spacer(Modifier.fillMaxWidth().height(1.dp).background(colors.border))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.navigationBars)
                .height(PlaylyTheme.spacing.bottomBarHeight)
                .selectableGroup(),
        ) {
            TopLevelDestination.entries.forEach { destination ->
                val selected = current.isIn(destination)
                val tint by animateColorAsState(
                    targetValue = if (selected) colors.textPrimary else colors.textMuted,
                    animationSpec = PlaylyTheme.motion.press(),
                    label = "navTint",
                )
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .selectable(selected = selected, role = Role.Tab, onClick = { onSelect(destination) }),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    PlaylyIcon(destination.icon, contentDescription = null, tint = tint)
                    Spacer(Modifier.height(PlaylyTheme.spacing.xxs))
                    Text(stringResource(destination.label), style = PlaylyTheme.typography.navLabel, color = tint, maxLines = 1)
                }
            }
        }
    }
}

private fun NavDestination?.isIn(destination: TopLevelDestination): Boolean =
    this?.hierarchy?.any { it.hasRoute(destination.route::class) } == true

/**
 * Standard tab switch: one copy of each tab, state saved and restored, back returns to Home.
 * Selecting the tab that is already open goes back to its first screen.
 */
fun NavController.navigateToTopLevel(destination: TopLevelDestination) {
    if (currentDestination.isIn(destination)) {
        popBackStack(destination.root, inclusive = false)
        return
    }
    navigate(destination.route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
