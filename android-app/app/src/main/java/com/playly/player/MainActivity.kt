package com.playly.player

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.playly.player.playback.PlaybackCommands
import com.playly.player.ui.AppViewModel
import com.playly.player.ui.PlaylyRoot

class MainActivity : ComponentActivity() {
    /** The same instance PlaylyRoot gets from viewModel(): both use this activity's store. */
    private val appViewModel: AppViewModel by viewModels { AppViewModel.Factory }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        // A recreated activity (rotation, process restore) already restored whether the player is open.
        if (savedInstanceState == null) handleIntent(intent)
        setContent { PlaylyRoot(appViewModel) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** Tapping the media notification opens the full-screen player (spec §9). */
    private fun handleIntent(intent: Intent?) {
        if (intent?.action != PlaybackCommands.ACTION_OPEN_PLAYER) return
        // Reopened from Recents, the original intent comes back: that is not a new tap.
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        appViewModel.requestOpenPlayer()
    }
}
