package com.musicadj.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/**
 * Servicio en primer plano de tipo "reproducción multimedia".
 * Mantiene viva la app (y su motor de audio) con la pantalla bloqueada o en
 * segundo plano, y muestra una notificación con controles que también
 * aparecen en la pantalla de bloqueo y responden a auriculares Bluetooth.
 */
public class PlaybackService extends Service {

    static final String CHANNEL_ID = "playback";
    static final int NOTIFICATION_ID = 7;
    static final String ACTION_TOGGLE = "com.musicadj.app.TOGGLE";
    static final String ACTION_NEXT = "com.musicadj.app.NEXT";
    static final String ACTION_PREV = "com.musicadj.app.PREV";

    static PlaybackPlugin plugin;
    private static PlaybackService instance;
    private static final Handler main = new Handler(Looper.getMainLooper());

    private MediaSession session;
    private PowerManager.WakeLock wakeLock;
    private String title = "Musica DJ";
    private String text = "";
    private boolean playing = false;
    private boolean inForeground = false;

    /* ── llamadas desde el plugin ── */

    static void update(Context ctx, String title, String text, boolean playing) {
        main.post(() -> {
            if (instance != null) {
                instance.apply(title, text, playing);
                return;
            }
            Intent i = new Intent(ctx, PlaybackService.class);
            i.putExtra("title", title);
            i.putExtra("text", text);
            i.putExtra("playing", playing);
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else ctx.startService(i);
        });
    }

    static void stop(Context ctx) {
        main.post(() -> ctx.stopService(new Intent(ctx, PlaybackService.class)));
    }

    private static void emit(String action) {
        if (plugin != null) plugin.emit(action);
    }

    /* ── ciclo de vida ── */

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();

        session = new MediaSession(this, "MusicaDJ");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { emit("play"); }
            @Override public void onPause() { emit("pause"); }
            @Override public void onSkipToNext() { emit("next"); }
            @Override public void onSkipToPrevious() { emit("prev"); }
            @Override public void onStop() { emit("pause"); }
        });
        session.setActive(true);

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MusicaDJ::playback");
        wakeLock.setReferenceCounted(false);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_TOGGLE.equals(action)) emit("toggle");
        else if (ACTION_NEXT.equals(action)) emit("next");
        else if (ACTION_PREV.equals(action)) emit("prev");
        else if (intent != null) {
            apply(
                intent.getStringExtra("title") != null ? intent.getStringExtra("title") : title,
                intent.getStringExtra("text") != null ? intent.getStringExtra("text") : text,
                intent.getBooleanExtra("playing", playing)
            );
        }
        if (!inForeground) apply(title, text, playing); // toda llamada de inicio debe pasar a primer plano
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Si el usuario cierra la app desde "recientes", se detiene todo.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (session != null) session.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /* ── notificación ── */

    private void apply(String title, String text, boolean playing) {
        this.title = title;
        this.text = text;
        this.playing = playing;

        session.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, text)
            .build());
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build());

        // El wake lock evita que el procesador se duerma mientras suena música.
        if (playing && !wakeLock.isHeld()) wakeLock.acquire();
        else if (!playing && wakeLock.isHeld()) wakeLock.release();

        Notification n = buildNotification();
        if (!inForeground) {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(NOTIFICATION_ID, n);
            inForeground = true;
        } else {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(NOTIFICATION_ID, n);
        }
    }

    private PendingIntent actionIntent(String action, int code) {
        Intent i = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @SuppressWarnings("deprecation")
    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(content)
            .setOngoing(playing)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setColor(0xFF000000)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Anterior", actionIntent(ACTION_PREV, 1)).build())
            .addAction(new Notification.Action.Builder(
                playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                playing ? "Pausa" : "Reproducir",
                actionIntent(ACTION_TOGGLE, 2)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Siguiente", actionIntent(ACTION_NEXT, 3)).build())
            .setStyle(new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_LOW);
        return b.build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Reproducción", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Controles de la música que está sonando");
        ch.setShowBadge(false);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.createNotificationChannel(ch);
    }
}
