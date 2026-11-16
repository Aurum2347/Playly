package com.playly.player.ui.navigation

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import com.playly.player.R
import kotlinx.serialization.Serializable

/** The Home tab's own back stack: Home and its sub-pages keep the bottom bar. */
@Serializable data object HomeGraph
@Serializable data object HomeRoute
@Serializable data object RecentRoute
@Serializable data object LibraryRoute
@Serializable data object PlaylistsRoute
@Serializable data object SearchRoute
@Serializable data object SettingsRoute
@Serializable data object FavoritesRoute
/** A playlist's page; outside the tab graphs, like Settings, so it opens from Search as well. */
@Serializable data class PlaylistRoute(val id: Long)
/** "Add tracks" picker of a playlist. */
@Serializable data class AddTracksRoute(val playlistId: Long)
/** An album, artist, genre or folder page (stage 7); [kind] is a CollectionKind name. */
@Serializable data class CollectionRoute(val kind: String, val key: String)

/**
 * The four bottom-bar destinations (spec §4). [route] is what the tab navigates to (a graph
 * when the tab has sub-pages), [root] its first screen, where re-selecting the tab returns.
 */
enum class TopLevelDestination(
    val route: Any,
    val root: Any,
    @StringRes val label: Int,
    @DrawableRes val icon: Int,
) {
    Home(HomeGraph, HomeRoute, R.string.nav_home, R.drawable.ic_home),
    Library(LibraryRoute, LibraryRoute, R.string.nav_library, R.drawable.ic_library),
    Playlists(PlaylistsRoute, PlaylistsRoute, R.string.nav_playlists, R.drawable.ic_playlists),
    Search(SearchRoute, SearchRoute, R.string.nav_search, R.drawable.ic_search),
}
