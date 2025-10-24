package com.example.sensorlogger.repository

import com.example.sensorlogger.model.TelemetryUiState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

object TelemetryStateStore {
    private val _state = MutableStateFlow(TelemetryUiState())
    val state: StateFlow<TelemetryUiState> = _state.asStateFlow()

    fun update(transform: (TelemetryUiState) -> TelemetryUiState) {
        _state.value = transform(_state.value)
    }
}
