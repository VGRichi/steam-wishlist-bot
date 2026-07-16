create table if not exists users (
  chat_id bigint primary key,
  region_code text,
  pending_action text,
  created_at timestamptz default now()
);

create table if not exists tracked_games (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null references users(chat_id) on delete cascade,
  app_id integer not null,
  game_name text not null,
  added_at timestamptz default now(),
  unique (chat_id, app_id)
);

create table if not exists price_cache (
  app_id integer not null,
  region_code text not null,
  last_price_cents integer,
  last_discount_percent integer,
  last_checked_at timestamptz default now(),
  primary key (app_id, region_code)
);

create index if not exists idx_tracked_games_chat_id on tracked_games(chat_id);
create index if not exists idx_tracked_games_app_id on tracked_games(app_id);
