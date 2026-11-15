package com.playly.player

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import com.playly.player.data.artwork.ArtworkImageLoader

class PlaylyApplication : Application(), SingletonImageLoader.Factory {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        // Scans start when the app comes to the foreground and stop observing when it leaves.
        container.scanner.start()
        // Connects to the playback session while the UI is visible.
        container.playback.start()
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader = ArtworkImageLoader.create(this)
}
