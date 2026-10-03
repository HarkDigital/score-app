package digital.hark.scores;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BlurMaskFilter;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import org.json.JSONObject;

// Team logos for the Lock Screen notification, as on iPhone: ESPN's logo,
// downloaded once and kept small in the app's files, with a soft white glow
// so a dark logo (Iowa's black hawk) shows on a dark shade; or, without one,
// a circle in the team's color with its abbreviation.
final class TeamLogos {

    private TeamLogos() {}

    // A card team: {abbr, name, color ("#rrggbb" or null), logo (URL or null)}.
    // Blocks while downloading: call off the main thread.
    static Bitmap badge(Context c, JSONObject team, int px) {
        Bitmap logo = load(c, team.optString("logo", ""));
        return logo != null ? glow(logo, px) : fallback(team, px);
    }

    private static Bitmap load(Context c, String url) {
        if (!url.startsWith("https://a.espncdn.com/")) return null;
        File file = new File(new File(c.getFilesDir(), "logos"), sha1(url) + ".png");
        if (file.exists()) {
            Bitmap cached = BitmapFactory.decodeFile(file.getPath());
            if (cached != null) return cached;
        }
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(6_000);
            conn.setReadTimeout(6_000);
            if (conn.getResponseCode() != 200) return null;
            Bitmap full;
            try (InputStream in = conn.getInputStream()) {
                full = BitmapFactory.decodeStream(in);
            }
            if (full == null || full.getWidth() == 0 || full.getHeight() == 0) return null;
            // 160px: plenty for a 44dp logo, and light in a notification.
            float scale = Math.min(1f, 160f / Math.max(full.getWidth(), full.getHeight()));
            Bitmap small = Bitmap.createScaledBitmap(full, Math.round(full.getWidth() * scale), Math.round(full.getHeight() * scale), true);
            file.getParentFile().mkdirs();
            try (FileOutputStream out = new FileOutputStream(file)) {
                small.compress(Bitmap.CompressFormat.PNG, 100, out);
            }
            return small;
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // The logo fit into px, over a blurred white copy of its own shape.
    private static Bitmap glow(Bitmap logo, int px) {
        Bitmap out = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        float inner = px * 0.82f;
        float scale = Math.min(inner / logo.getWidth(), inner / logo.getHeight());
        int w = Math.max(1, Math.round(logo.getWidth() * scale));
        int h = Math.max(1, Math.round(logo.getHeight() * scale));
        Bitmap fitted = Bitmap.createScaledBitmap(logo, w, h, true);
        int left = (px - w) / 2;
        int top = (px - h) / 2;

        Paint blur = new Paint();
        blur.setMaskFilter(new BlurMaskFilter(Math.max(2f, px * 0.06f), BlurMaskFilter.Blur.NORMAL));
        int[] offset = new int[2];
        Bitmap halo = fitted.extractAlpha(blur, offset);
        Paint white = new Paint(Paint.ANTI_ALIAS_FLAG);
        white.setColor(Color.argb(170, 255, 255, 255));
        canvas.drawBitmap(halo, left + offset[0], top + offset[1], white);
        canvas.drawBitmap(fitted, left, top, new Paint(Paint.FILTER_BITMAP_FLAG));
        return out;
    }

    // Phade's TeamLogo fallback: the team's color with its abbreviation.
    private static Bitmap fallback(JSONObject team, int px) {
        Bitmap out = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        int color = 0xFF374151;
        try {
            String hex = team.optString("color", "");
            if (hex.matches("#[0-9a-fA-F]{6}")) color = Color.parseColor(hex);
        } catch (IllegalArgumentException ignored) {
            // keep the gray
        }
        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setColor(color);
        canvas.drawCircle(px / 2f, px / 2f, px / 2f, fill);

        int r = Color.red(color), g = Color.green(color), b = Color.blue(color);
        boolean light = 0.299 * r + 0.587 * g + 0.114 * b > 186;
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setColor(light ? 0xFF0A0A0A : Color.WHITE);
        text.setFakeBoldText(true);
        text.setTextAlign(Paint.Align.CENTER);
        String abbr = team.optString("abbr", "");
        text.setTextSize(px * 0.3f);
        float max = px * 0.84f;
        if (text.measureText(abbr) > max) text.setTextSize(text.getTextSize() * max / text.measureText(abbr));
        Rect bounds = new Rect();
        text.getTextBounds(abbr, 0, abbr.length(), bounds);
        canvas.drawText(abbr, px / 2f, px / 2f + bounds.height() / 2f, text);
        return out;
    }

    private static String sha1(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-1").digest(value.getBytes("UTF-8"));
            StringBuilder hex = new StringBuilder();
            for (byte d : digest) hex.append(String.format("%02x", d));
            return hex.toString();
        } catch (Exception e) {
            return Integer.toHexString(value.hashCode());
        }
    }
}
