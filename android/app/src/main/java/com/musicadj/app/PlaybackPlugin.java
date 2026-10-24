package com.musicadj.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Puente entre la app web y el servicio de reproducción.
 * JS → update({ title, text, playing }) / stop()
 * Nativo → evento "action" con { action: "toggle" | "play" | "pause" | "next" | "prev" }
 */
@CapacitorPlugin(name = "PlaybackService")
public class PlaybackPlugin extends Plugin {

    private boolean askedNotifications = false;

    @Override
    public void load() {
        PlaybackService.plugin = this;
    }

    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title", "Musica DJ");
        String text = call.getString("text", "");
        boolean playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        askForNotifications();
        PlaybackService.update(getContext(), title, text, playing);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        PlaybackService.stop(getContext());
        call.resolve();
    }

    void emit(String action) {
        JSObject data = new JSObject();
        data.put("action", action);
        notifyListeners("action", data);
    }

    // Android 13+: pedir permiso para mostrar la notificación con los controles.
    private void askForNotifications() {
        if (askedNotifications || Build.VERSION.SDK_INT < 33 || getActivity() == null) return;
        askedNotifications = true;
        String perm = Manifest.permission.POST_NOTIFICATIONS;
        if (ContextCompat.checkSelfPermission(getContext(), perm) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[] { perm }, 4201);
        }
    }
}
