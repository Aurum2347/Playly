package com.playly.player.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        LibrarySourceEntity::class,
        TrackEntity::class,
        PlaylistEntity::class,
        PlaylistEntryEntity::class,
        PlayHistoryEntity::class,
        FavoriteEntity::class,
    ],
    version = PlaylyDatabase.VERSION,
    exportSchema = true,
)
abstract class PlaylyDatabase : RoomDatabase() {
    abstract fun trackDao(): TrackDao
    abstract fun librarySourceDao(): LibrarySourceDao
    abstract fun playlistDao(): PlaylistDao
    abstract fun playHistoryDao(): PlayHistoryDao
    abstract fun favoriteDao(): FavoriteDao

    companion object {
        const val NAME = "playly.db"
        const val VERSION = 5

        /**
         * Every schema change needs a Migration here and a new exported schema in app/schemas.
         * There is deliberately no destructive fallback: an update must never wipe playlists.
         */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE library_sources ADD COLUMN is_accessible INTEGER NOT NULL DEFAULT 1")
                db.execSQL("ALTER TABLE tracks ADD COLUMN album_id INTEGER")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_tracks_folder_path ON tracks (folder_path)")
            }
        }

        /** Stage 4: play history for "Recently played". */
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `play_history` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                        "`track_id` INTEGER NOT NULL, `played_at` INTEGER NOT NULL, " +
                        "FOREIGN KEY(`track_id`) REFERENCES `tracks`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_play_history_track_id` ON `play_history` (`track_id`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_play_history_played_at` ON `play_history` (`played_at`)")
            }
        }

        /** Stage 6: each playlist remembers how its page is sorted. */
        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE playlists ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            }
        }

        /** Stage 8.1: favourite tracks. */
        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `favorites` (`track_id` INTEGER NOT NULL, `added_at` INTEGER NOT NULL, " +
                        "PRIMARY KEY(`track_id`), " +
                        "FOREIGN KEY(`track_id`) REFERENCES `tracks`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_favorites_added_at` ON `favorites` (`added_at`)")
            }
        }

        val MIGRATIONS: Array<Migration> = arrayOf(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)

        fun build(context: Context): PlaylyDatabase =
            Room.databaseBuilder(context, PlaylyDatabase::class.java, NAME)
                .addMigrations(*MIGRATIONS)
                .build()
    }
}
