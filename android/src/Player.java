package com.playly.player;

import android.app.*;
import android.content.*;
import android.media.*;
import android.media.session.*;
import android.net.Uri;
import android.os.*;
import java.util.*;
import org.json.*;

public class Player extends Service {
  static final String CHANNEL = "playback";
  static final int NOTICE = 11;

  final class Connection extends Binder {
    Player service() {
      return Player.this;
    }
  }

  final Connection binder = new Connection();
  final ArrayList<String> queue = new ArrayList<>();
  final ArrayList<String> shuffled = new ArrayList<>();
  String uri = "", title = "", artist = "", error = "";
  boolean ready, shuffle, resumeOnFocus, wantsPlay;
  int repeat;
  MediaPlayer engine;
  android.media.audiofx.Equalizer eq;
  int preset;

  void applyPreset(int choice) {
    preset = choice;
    prefs().edit().putInt("preset", choice).apply();
    if (!ready) return;
    try {
      if (choice == 0) {
        if (eq != null) eq.setEnabled(false);
        return;
      }
      if (eq == null) eq = new android.media.audiofx.Equalizer(0, engine.getAudioSessionId());
      short[] range = eq.getBandLevelRange();
      for (short i = 0; i < eq.getNumberOfBands(); i++) {
        int hz = eq.getCenterFreq(i) / 1000;
        int gain =
            choice == 1 && hz < 260
                ? 450
                : choice == 2 && hz >= 500 && hz <= 4000 ? 300 : choice == 3 && hz > 3500 ? 400 : 0;
        eq.setBandLevel(i, (short) Math.max(range[0], Math.min(range[1], gain)));
      }
      eq.setEnabled(true);
    } catch (RuntimeException e) {
      error = "Аудиоустройство не поддерживает эквалайзер";
    }
  }

  MediaSession session;
  AudioManager audio;
  AudioFocusRequest focus;

  final BroadcastReceiver headphones =
      new BroadcastReceiver() {
        public void onReceive(Context context, Intent intent) {
          pause();
        }
      };

  public IBinder onBind(Intent intent) {
    return binder;
  }

  public void onCreate() {
    super.onCreate();
    audio = getSystemService(AudioManager.class);
    focus =
        new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attributes())
            .setOnAudioFocusChangeListener(
                change -> {
                  if (change == AudioManager.AUDIOFOCUS_GAIN && resumeOnFocus) {
                    resumeOnFocus = false;
                    play();
                  } else if (change < 0) {
                    if (change == AudioManager.AUDIOFOCUS_LOSS) pause();
                    else if (wantsPlay) {
                      wantsPlay = false;
                      resumeOnFocus = true;
                      if (playing()) engine.pause();
                      publish();
                    }
                  }
                })
            .build();
    registerReceiver(headphones, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
    getSystemService(NotificationManager.class)
        .createNotificationChannel(
            new NotificationChannel(CHANNEL, "Музыка", NotificationManager.IMPORTANCE_LOW));
    session = new MediaSession(this, "Playly");
    session.setCallback(
        new MediaSession.Callback() {
          public void onPlay() {
            play();
          }

          public void onPause() {
            pause();
          }

          public void onSkipToNext() {
            skip(1);
          }

          public void onSkipToPrevious() {
            previous();
          }

          public void onSeekTo(long position) {
            seek((int) position);
          }
        });
    preset = prefs().getInt("preset", 0);
    shuffle = prefs().getBoolean("shuffle", false);
    repeat = prefs().getInt("repeat", 0);
  }

  SharedPreferences prefs() {
    return getSharedPreferences("playly", MODE_PRIVATE);
  }

  static AudioAttributes attributes() {
    return new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build();
  }

  JSONObject library() {
    try {
      return new JSONObject(prefs().getString("tracks", "{}"));
    } catch (JSONException e) {
      throw new IllegalStateException(e);
    }
  }

  void select(String id, JSONArray selection) {
    JSONObject tracks = library();
    if (!tracks.has(id)) return;
    queue.clear();
    for (int i = 0; i < selection.length(); i++) {
      String item = selection.optString(i);
      if (tracks.has(item)) queue.add(item);
    }
    if (!queue.contains(id)) queue.add(id);
    rebuildShuffle(id);
    load(id);
  }

  void rebuildShuffle(String first) {
    shuffled.clear();
    if (!shuffle || !queue.contains(first)) return;
    shuffled.addAll(queue);
    shuffled.remove(first);
    Collections.shuffle(shuffled);
    shuffled.add(0, first);
  }

  List<String> order() {
    return shuffle ? shuffled : queue;
  }

  void load(String id) {
    JSONObject item = library().optJSONObject(id);
    if (item == null) return;
    releaseEngine();
    uri = id;
    title = item.optString("title");
    artist = item.optString("artist");
    wantsPlay = true;
    error = "";
    try {
      engine = new MediaPlayer();
      engine.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
      engine.setAudioAttributes(attributes());
      engine.setDataSource(this, Uri.parse(item.optString("source", id)));
      engine.setOnPreparedListener(
          p -> {
            if (engine != p) return;
            ready = true;
            applyPreset(preset);
            if (wantsPlay) play();
            else publish();
          });
      engine.setOnErrorListener(
          (p, what, extra) -> {
            if (engine == p) failed();
            return true;
          });
      engine.setOnCompletionListener(
          p -> {
            if (engine != p) return;
            if (repeat == 1) {
              seek(0);
              play();
            } else if (repeat == 2 || order().indexOf(uri) < order().size() - 1) skip(1);
            else {
              pause();
              seek(0);
            }
          });
      engine.prepareAsync();
      publish();
    } catch (Exception e) {
      failed();
    }
  }

  void failed() {
    releaseEngine();
    error = "Не удалось открыть трек. Откройте меню трека и выберите «Указать файл заново».";
    pause();
  }

  boolean playing() {
    return ready && engine.isPlaying();
  }

  int position() {
    return ready ? engine.getCurrentPosition() : 0;
  }

  int duration() {
    return ready ? Math.max(0, engine.getDuration()) : 0;
  }

  void play() {
    if (uri.isEmpty()) return;
    if (engine == null) {
      load(uri);
      return;
    }
    wantsPlay = true;
    if (!ready) return;
    try {
      startService(new Intent(this, Player.class));
      startForeground(NOTICE, notification());
    } catch (IllegalStateException e) {
      error = "Откройте Playly, чтобы продолжить воспроизведение";
      pause();
      return;
    }
    if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
      pause();
      return;
    }
    engine.start();
    session.setActive(true);
    publish();
  }

  void pause() {
    wantsPlay = resumeOnFocus = false;
    if (playing()) engine.pause();
    publish();
    audio.abandonAudioFocusRequest(focus);
    stopForeground(STOP_FOREGROUND_DETACH);
    stopSelf();
  }

  void seek(int pos) {
    if (ready) {
      engine.seekTo(Math.min(duration(), Math.max(0, pos)));
      publish();
    }
  }

  void previous() {
    if (position() > 3000) seek(0);
    else skip(-1);
  }

  void skip(int direction) {
    List<String> order = order();
    if (order.isEmpty()) return;
    load(order.get(Math.floorMod(order.indexOf(uri) + direction, order.size())));
  }

  PendingIntent action(String command) {
    return PendingIntent.getService(
        this, 0, new Intent(this, Player.class).setAction(command), PendingIntent.FLAG_IMMUTABLE);
  }

  Notification notification() {
    PendingIntent open =
        PendingIntent.getActivity(
            this, 0, new Intent(this, Main.class), PendingIntent.FLAG_IMMUTABLE);
    return new Notification.Builder(this, CHANNEL)
        .setSmallIcon(android.R.drawable.ic_media_play)
        .setContentTitle(title)
        .setContentText(artist)
        .setContentIntent(open)
        .setOnlyAlertOnce(true)
        .setStyle(
            new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2))
        .addAction(android.R.drawable.ic_media_previous, "Назад", action("prev"))
        .addAction(
            playing() ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
            playing() ? "Пауза" : "Играть",
            action("toggle"))
        .addAction(android.R.drawable.ic_media_next, "Далее", action("next"))
        .build();
  }

  void publish() {
    if (uri.isEmpty()) return;
    session.setMetadata(
        new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, duration())
            .build());
    session.setPlaybackState(
        new PlaybackState.Builder()
            .setActions(
                PlaybackState.ACTION_PLAY_PAUSE
                    | PlaybackState.ACTION_PLAY
                    | PlaybackState.ACTION_PAUSE
                    | PlaybackState.ACTION_SKIP_TO_NEXT
                    | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                    | PlaybackState.ACTION_SEEK_TO)
            .setState(
                playing() ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                position(),
                playing() ? 1 : 0)
            .build());
    getSystemService(NotificationManager.class).notify(NOTICE, notification());
  }

  public int onStartCommand(Intent intent, int flags, int startId) {
    String cmd = intent == null ? null : intent.getAction();
    if ("prev".equals(cmd)) previous();
    if ("next".equals(cmd)) skip(1);
    if ("toggle".equals(cmd)) {
      if (playing()) pause();
      else play();
    }
    return START_NOT_STICKY;
  }

  void releaseEngine() {
    ready = false;
    if (eq != null) {
      eq.release();
      eq = null;
    }
    if (engine != null) {
      engine.release();
      engine = null;
    }
  }

  public void onDestroy() {
    unregisterReceiver(headphones);
    releaseEngine();
    session.release();
    audio.abandonAudioFocusRequest(focus);
    getSystemService(NotificationManager.class).cancel(NOTICE);
    super.onDestroy();
  }
}
