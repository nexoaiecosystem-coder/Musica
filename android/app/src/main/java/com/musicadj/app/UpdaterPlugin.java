package com.musicadj.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.plugin.WebView;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Actualizaciones sin reinstalar:
 *  - downloadBundle: baja la interfaz nueva (zip publicado en GitHub Pages) y
 *    la descomprime en el almacenamiento de la app.
 *  - applyBundle: la activa ahora o en el próximo arranque. Se sirve desde el
 *    mismo origen (https://localhost), así la biblioteca guardada no se pierde.
 *  - installApk: para los cambios en la parte nativa, baja el APK nuevo y abre
 *    el instalador de Android.
 *
 * Red de seguridad: si una interfaz descargada no arranca bien (no llama a
 * confirm() en 20 s), se vuelve a la que trae el APK y esa versión se marca
 * como mala para no volver a bajarla.
 */
@CapacitorPlugin(name = "AppUpdater")
public class UpdaterPlugin extends Plugin {

    private static final String PREFS = "MusicaUpdater";
    private boolean confirmed = false;
    private final Handler main = new Handler(Looper.getMainLooper());

    private File bundlesDir() {
        return new File(getContext().getFilesDir(), "web-bundles");
    }

    @Override
    public void load() {
        scheduleHealthCheck();
    }

    private void scheduleHealthCheck() {
        confirmed = false;
        main.postDelayed(() -> {
            if (confirmed || getBridge() == null) return;
            String base = getBridge().getServerBasePath();
            if (base == null || !base.contains("web-bundles")) return;
            getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE).edit()
                .putString("badVersion", new File(base).getName()).apply();
            getContext().getSharedPreferences(WebView.WEBVIEW_PREFS_NAME, Activity.MODE_PRIVATE).edit()
                .putString(WebView.CAP_SERVER_PATH, "").apply();
            getBridge().setServerAssetPath("public");
        }, 20000);
    }

    // La interfaz arrancó bien.
    @PluginMethod
    public void confirm(PluginCall call) {
        confirmed = true;
        call.resolve();
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            PackageInfo p = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
            ret.put("versionCode", code);
            ret.put("versionName", p.versionName);
        } catch (Exception e) {
            ret.put("versionCode", 0);
        }
        ret.put("badVersion", getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE).getString("badVersion", ""));
        call.resolve(ret);
    }

    @PluginMethod
    public void downloadBundle(PluginCall call) {
        String url = call.getString("url");
        String version = call.getString("version", "0");
        if (url == null) {
            call.reject("Falta la URL");
            return;
        }
        new Thread(() -> {
            File dir = new File(bundlesDir(), version.replaceAll("[^0-9A-Za-z_-]", ""));
            File tmp = new File(bundlesDir(), "tmp-" + System.currentTimeMillis());
            try {
                deleteRecursive(tmp);
                if (!tmp.mkdirs()) throw new IOException("No se pudo crear la carpeta");
                try (InputStream in = open(url); ZipInputStream zip = new ZipInputStream(new BufferedInputStream(in))) {
                    String root = tmp.getCanonicalPath() + File.separator;
                    ZipEntry e;
                    byte[] buf = new byte[64 * 1024];
                    while ((e = zip.getNextEntry()) != null) {
                        File out = new File(tmp, e.getName());
                        if (!out.getCanonicalPath().startsWith(root)) throw new IOException("Ruta no válida en el zip");
                        if (e.isDirectory()) {
                            out.mkdirs();
                            continue;
                        }
                        out.getParentFile().mkdirs();
                        try (OutputStream os = new FileOutputStream(out)) {
                            int n;
                            while ((n = zip.read(buf)) > 0) os.write(buf, 0, n);
                        }
                    }
                }
                if (!new File(tmp, "index.html").exists()) throw new IOException("El paquete no tiene index.html");
                deleteRecursive(dir);
                if (!tmp.renameTo(dir)) throw new IOException("No se pudo guardar la actualización");
                JSObject ret = new JSObject();
                ret.put("path", dir.getAbsolutePath());
                call.resolve(ret);
            } catch (Exception ex) {
                deleteRecursive(tmp);
                call.reject("No se pudo descargar la actualización: " + ex.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void applyBundle(PluginCall call) {
        String path = call.getString("path");
        boolean now = Boolean.TRUE.equals(call.getBoolean("now", false));
        if (path == null || !new File(path, "index.html").exists()) {
            call.reject("Actualización no encontrada");
            return;
        }
        // Lo mismo que hace Capacitor al guardar la ruta: se usará en cada arranque
        // hasta que se instale un APK nuevo (que trae su propia interfaz).
        SharedPreferences prefs = getContext().getSharedPreferences(WebView.WEBVIEW_PREFS_NAME, Activity.MODE_PRIVATE);
        prefs.edit().putString(WebView.CAP_SERVER_PATH, path).apply();
        cleanOldBundles(path);
        call.resolve();
        if (now) {
            getBridge().executeOnMainThread(() -> {
                getBridge().setServerBasePath(path);
                scheduleHealthCheck();
            });
        }
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("Falta la URL");
            return;
        }
        Context ctx = getContext();
        // Android 8+: hay que permitir "instalar apps desconocidas" para esta app.
        if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            JSObject ret = new JSObject();
            ret.put("needsPermission", true);
            call.resolve(ret);
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(ctx.getCacheDir(), "updates");
                dir.mkdirs();
                File apk = new File(dir, "MusicaDJ.apk");
                try (InputStream in = open(url); OutputStream os = new FileOutputStream(apk)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
                Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                call.resolve(new JSObject());
            } catch (Exception ex) {
                call.reject("No se pudo descargar la app: " + ex.getMessage());
            }
        }).start();
    }

    /* ── utilidades ── */

    // Sigue redirecciones (GitHub manda las descargas a otro dominio).
    private InputStream open(String url) throws IOException {
        for (int i = 0; i < 6; i++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("Cache-Control", "no-cache");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                url = new URL(new URL(url), c.getHeaderField("Location")).toString();
                c.disconnect();
                continue;
            }
            if (code != 200) throw new IOException("HTTP " + code);
            return c.getInputStream();
        }
        throw new IOException("Demasiadas redirecciones");
    }

    private void cleanOldBundles(String keep) {
        File[] all = bundlesDir().listFiles();
        if (all == null) return;
        for (File f : all) if (!f.getAbsolutePath().equals(keep)) deleteRecursive(f);
    }

    private static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRecursive(k);
        f.delete();
    }
}
