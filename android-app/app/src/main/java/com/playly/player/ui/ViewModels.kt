package com.playly.player.ui

import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.viewmodel.CreationExtras
import com.playly.player.AppContainer
import com.playly.player.PlaylyApplication

/** Access to the app container from ViewModel factories. */
val CreationExtras.container: AppContainer
    get() = (requireNotNull(this[APPLICATION_KEY]) as PlaylyApplication).container
