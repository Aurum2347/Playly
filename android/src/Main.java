package com.playly.player;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.graphics.*;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.*;
import android.provider.OpenableColumns;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;
import org.json.*;

public class Main extends Activity {
  WebView web;
  Player player;
  SharedPreferences prefs;
  final ExecutorService worker = Executors.newSingleThreadExecutor();
  final Handler clock = new Handler(Looper.getMainLooper());
  String available = "";
  boolean checking;
  final ServiceConnection connection =
      new ServiceConnection() {
        public void onServiceConnected(ComponentName name, IBinder binder) {
          player = ((Player.Connection) binder).service();
        }

        public void onServiceDisconnected(ComponentName name) {
          player = null;
        }
      };
  final Runnable tick =
      new Runnable() {
        public void run() {
          if (player != null) {
            JSONObject state = new JSONObject();
            try {
              state
                  .put("uri", player.uri)
                  .put("playing", player.playing())
                  .put("pos", player.position())
                  .put("duration", player.duration())
                  .put("shuffle", player.shuffle)
                  .put("repeat", player.repeat);
              send("state", state.toString());
              if (!player.error.isEmpty()) {
                toast(player.error);
                player.error = "";
              }
            } catch (JSONException e) {
              throw new IllegalStateException(e);
            }
          }
          clock.postDelayed(this, 500);
        }
      };

  public void onCreate(Bundle saved) {
    super.onCreate(saved);
    prefs = getSharedPreferences("playly", MODE_PRIVATE);
    web = new WebView(this);
    web.setBackgroundColor(0xff0a0a0c);
    FrameLayout frame = new FrameLayout(this);
    frame.setBackgroundColor(0xff0a0a0c);
    frame.addView(web);
    frame.setOnApplyWindowInsetsListener(
        (v, insets) -> {
          v.setPadding(
              insets.getSystemWindowInsetLeft(),
              insets.getSystemWindowInsetTop(),
              insets.getSystemWindowInsetRight(),
              insets.getSystemWindowInsetBottom());
          return insets.consumeSystemWindowInsets();
        });
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setAllowFileAccess(false);
    web.getSettings().setAllowContentAccess(false);
    web.getSettings().setBlockNetworkLoads(true);
    web.setWebViewClient(
        new WebViewClient() {
          public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest r) {
            return true;
          }

          public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
            Uri url = req.getUrl();
            if ("https".equals(url.getScheme()) && "playly.invalid".equals(url.getHost())) {
              String path = url.getPath();
              try {
                if ("/".equals(path)) return asset("index.html", "text/html");
                if ("/app.js".equals(path)) return asset("app.js", "application/javascript");
                if ("/style.css".equals(path)) return asset("style.css", "text/css");
                if (path.matches("/cover/[0-9a-f-]{36}"))
                  return new WebResourceResponse(
                      "image/jpeg",
                      null,
                      new FileInputStream(new File(getFilesDir(), path.substring(7))));
              } catch (IOException ignored) {
              }
            }
            return new WebResourceResponse(
                "text/plain", "UTF-8", 404, "Missing", Collections.emptyMap(), null);
          }

          public void onPageFinished(WebView view, String url) {
            library();
            available =
                prefs.getInt("offerFor", 0) == versionCode()
                    ? prefs.getString("available", "")
                    : "";
            if (!available.isEmpty()) send("available", JSONObject.quote(available));
            if (prefs.getBoolean("auto", true)
                && System.currentTimeMillis() - prefs.getLong("checked", 0) > 86400000L)
              check(false);
          }
        });
    web.addJavascriptInterface(new Bridge(), "Android");
    setContentView(frame);
    if (Build.VERSION.SDK_INT >= 33)
      getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::onBackPressed);
    WebView.setWebContentsDebuggingEnabled(
        (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
    bindService(new Intent(this, Player.class), connection, BIND_AUTO_CREATE);
    web.loadUrl("https://playly.invalid/");
  }

  WebResourceResponse asset(String name, String mime) throws IOException {
    return new WebResourceResponse(mime, "UTF-8", getAssets().open(name));
  }

  void send(String event, String json) {
    if (!isDestroyed())
      web.evaluateJavascript(
          "window.receive && receive(" + JSONObject.quote(event) + "," + json + ")", null);
  }

  void library() {
    send("library", prefs.getString("tracks", "{}"));
  }

  void toast(String message) {
    Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
  }

  public void onResume() {
    super.onResume();
    clock.post(tick);
  }

  public void onPause() {
    clock.removeCallbacks(tick);
    super.onPause();
  }

  public void onDestroy() {
    unbindService(connection);
    worker.shutdown();
    web.destroy();
    super.onDestroy();
  }

  public void onBackPressed() {
    web.evaluateJavascript(
        "window.back && back()",
        result -> {
          if (!"true".equals(result)) moveTaskToBack(true);
        });
  }

  final class Bridge {
    @JavascriptInterface
    public void pick() {
      runOnUiThread(
          () -> {
            Intent pick =
                new Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .setType("audio/*")
                    .addCategory(Intent.CATEGORY_OPENABLE);
            pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            startActivityForResult(pick, 1);
          });
    }

    @JavascriptInterface
    public void play(String id, String ids) {
      runOnUiThread(
          () -> {
            try {
              if (player != null) player.select(id, new JSONArray(ids));
            } catch (JSONException ignored) {
            }
          });
    }

    @JavascriptInterface
    public void control(String cmd, int value) {
      runOnUiThread(
          () -> {
            if (player == null) return;
            switch (cmd) {
              case "toggle":
                if (player.wantsPlay) player.pause();
                else player.play();
                break;
              case "next":
                player.skip(1);
                break;
              case "prev":
                player.previous();
                break;
              case "seek":
                player.seek(value);
                break;
              case "preset":
                if (value >= 0 && value <= 3) player.applyPreset(value);
                break;
              case "shuffle":
                player.shuffle = !player.shuffle;
                prefs.edit().putBoolean("shuffle", player.shuffle).apply();
                break;
              case "repeat":
                player.repeat = (player.repeat + 1) % 3;
                prefs.edit().putInt("repeat", player.repeat).apply();
                break;
            }
            clock.removeCallbacks(tick);
            tick.run();
          });
    }

    @JavascriptInterface
    public int preset() {
      return prefs.getInt("preset", 0);
    }

    @JavascriptInterface
    public boolean auto() {
      return prefs.getBoolean("auto", true);
    }

    @JavascriptInterface
    public void autoCheck(boolean on) {
      prefs.edit().putBoolean("auto", on).apply();
    }

    @JavascriptInterface
    public void equalizer() {
      runOnUiThread(
          () -> {
            if (player == null || !player.ready) {
              toast("Сначала включите трек");
              return;
            }
            Intent eq =
                new Intent(
                        android.media.audiofx.AudioEffect.ACTION_DISPLAY_AUDIO_EFFECT_CONTROL_PANEL)
                    .putExtra(
                        android.media.audiofx.AudioEffect.EXTRA_AUDIO_SESSION,
                        player.engine.getAudioSessionId())
                    .putExtra(
                        android.media.audiofx.AudioEffect.EXTRA_PACKAGE_NAME, getPackageName());
            try {
              startActivity(eq);
            } catch (ActivityNotFoundException e) {
              toast("На устройстве нет системного эквалайзера");
            }
          });
    }

    @JavascriptInterface
    public void forget(String id) {
      worker.execute(
          () -> {
            try {
              JSONObject tracks = new JSONObject(prefs.getString("tracks", "{}"));
              JSONObject track = tracks.optJSONObject(id);
              if (track == null) return;
              tracks.remove(id);
              if (!prefs.edit().putString("tracks", tracks.toString()).commit())
                throw new IOException();
              String cover = track.optString("cover");
              if (cover.matches("[0-9a-f-]{36}")) deleteFile(cover);
              try {
                getContentResolver()
                    .releasePersistableUriPermission(
                        Uri.parse(id), Intent.FLAG_GRANT_READ_URI_PERMISSION);
              } catch (SecurityException ignored) {
              }
              runOnUiThread(
                  () -> {
                    if (player != null) {
                      player.queue.remove(id);
                      if (player.uri.equals(id)) {
                        player.pause();
                        player.releaseEngine();
                        player.uri = "";
                        player.session.setActive(false);
                        getSystemService(NotificationManager.class).cancel(Player.NOTICE);
                      }
                    }
                    send("removed", JSONObject.quote(id));
                    library();
                  });
            } catch (Exception e) {
              runOnUiThread(() -> toast("Не удалось убрать трек"));
            }
          });
    }

    @JavascriptInterface
    public void update() {
      runOnUiThread(() -> check(true));
    }

    @JavascriptInterface
    public void download() {
      runOnUiThread(
          () -> {
            if (!available.isEmpty()) {
              try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(available)));
              } catch (ActivityNotFoundException e) {
                toast("Установите браузер для загрузки APK");
              }
            }
          });
    }
  }

  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request != 1 || result != RESULT_OK || data == null) return;
    LinkedHashSet<Uri> uris = new LinkedHashSet<>();
    ClipData clip = data.getClipData();
    if (clip != null)
      for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
    else if (data.getData() != null) uris.add(data.getData());
    toast("Импортируем треки…");
    worker.execute(
        () -> {
          int failed = 0;
          try {
            JSONObject tracks = new JSONObject(prefs.getString("tracks", "{}"));
            for (Uri uri : uris) {
              if (uri == null || !"content".equals(uri.getScheme()) || tracks.has(uri.toString()))
                continue;
              try {
                getContentResolver()
                    .takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                tracks.put(uri.toString(), metadata(uri));
              } catch (Exception e) {
                failed++;
              }
            }
            boolean saved = prefs.edit().putString("tracks", tracks.toString()).commit();
            final int errors = failed;
            runOnUiThread(
                () -> {
                  library();
                  if (!saved || errors > 0) toast("Часть треков не удалось сохранить");
                });
          } catch (JSONException e) {
            runOnUiThread(() -> toast("Не удалось прочитать библиотеку"));
          }
        });
  }

  JSONObject metadata(Uri uri) throws JSONException {
    String name = uri.getLastPathSegment();
    try (Cursor c =
        getContentResolver()
            .query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
      if (c != null && c.moveToFirst()) name = c.getString(0);
    }
    JSONObject track =
        new JSONObject()
            .put("title", name)
            .put("artist", "")
            .put("added", System.currentTimeMillis());
    MediaMetadataRetriever m = new MediaMetadataRetriever();
    try {
      m.setDataSource(this, uri);
      String title = m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
      if (title != null && !title.isEmpty()) track.put("title", title);
      track.put("artist", m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST));
      track.put("duration", m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
      byte[] art = m.getEmbeddedPicture();
      if (art != null) {
        BitmapFactory.Options opt = new BitmapFactory.Options();
        opt.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(art, 0, art.length, opt);
        opt.inSampleSize = 1;
        while (Math.max(opt.outWidth, opt.outHeight) / opt.inSampleSize > 768)
          opt.inSampleSize *= 2;
        opt.inJustDecodeBounds = false;
        Bitmap bitmap = BitmapFactory.decodeByteArray(art, 0, art.length, opt);
        if (bitmap != null) {
          String key = UUID.randomUUID().toString();
          try (FileOutputStream out = openFileOutput(key, MODE_PRIVATE)) {
            if (bitmap.compress(Bitmap.CompressFormat.JPEG, 86, out)) track.put("cover", key);
          } finally {
            bitmap.recycle();
          }
        }
      }
    } catch (Exception ignored) {
      /* Filename still identifies untagged media. */
    } finally {
      try {
        m.release();
      } catch (Exception ignored) {
      }
    }
    return track;
  }

  int versionCode() {
    try {
      return (int) getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode();
    } catch (android.content.pm.PackageManager.NameNotFoundException e) {
      throw new IllegalStateException(e);
    }
  }

  void check(boolean manual) {
    if (checking) return;
    checking = true;
    if (manual) toast("Проверяем Android-версию…");
    worker.execute(
        () -> {
          HttpURLConnection conn = null;
          String link = "", message = "У вас последняя Android-версия";
          boolean success = false;
          try {
            conn =
                (HttpURLConnection)
                    new URL("https://api.github.com/repos/Aurum2347/Playly/releases/tags/android")
                        .openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setRequestProperty("User-Agent", "Playly-Android");
            if (conn.getResponseCode() == 404) {
              message = "Android-релиз пока не опубликован";
              success = true;
            } else {
              StringBuilder body = new StringBuilder();
              try (BufferedReader in =
                  new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"))) {
                String line;
                while ((line = in.readLine()) != null) {
                  body.append(line);
                  if (body.length() > 2000000) throw new IOException();
                }
              }
              JSONArray assets = new JSONObject(body.toString()).getJSONArray("assets");
              long newest =
                  getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode();
              boolean found = false;
              for (int i = 0; i < assets.length(); i++) {
                String name = assets.getJSONObject(i).getString("name");
                Matcher match =
                    Pattern.compile("Playly-android-([1-9][0-9]{0,9})\\.apk").matcher(name);
                if (!match.matches()) continue;
                found = true;
                long code = Long.parseLong(match.group(1));
                if (code > newest) {
                  newest = code;
                  link = "https://github.com/Aurum2347/Playly/releases/download/android/" + name;
                }
              }
              if (!found) message = "В релизе пока нет Android APK";
              success = true;
            }
          } catch (Exception e) {
            message = "Не удалось проверить обновление. Попробуйте позже.";
          } finally {
            if (conn != null) conn.disconnect();
          }
          if (success)
            prefs
                .edit()
                .putLong("checked", System.currentTimeMillis())
                .putString("available", link)
                .putInt("offerFor", versionCode())
                .apply();
          String result = link, status = message;
          boolean successfulCheck = success;
          runOnUiThread(
              () -> {
                checking = false;
                if (isDestroyed()) return;
                if (successfulCheck) available = result;
                send("update", JSONObject.quote(available));
                if (manual && result.isEmpty()) toast(status);
              });
        });
  }
}
