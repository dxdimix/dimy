-- 設定（表 user_settings）の変化を、ほかの端末の画面にすぐ知らせる（Realtime）。
-- これがなくても、画面に戻ったとき・1 分ごとに読み直すので、設定は揃う（すぐではないだけ）。
alter publication supabase_realtime add table public.user_settings;
