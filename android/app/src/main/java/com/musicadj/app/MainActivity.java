package com.musicadj.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin propio: mantiene la música sonando con la pantalla bloqueada.
        registerPlugin(PlaybackPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
