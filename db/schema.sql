-- სეკრეტ სანტა — მონაცემთა ბაზის სქემა (Supabase / PostgreSQL)
-- გაუშვით ერთხელ: Supabase Dashboard → SQL Editor → New query → ჩასვით → Run

create extension if not exists pgcrypto;

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,          -- შესვლის სახელი (პატარა ასოებით)
  display_name  text not null,
  pin_hash      text not null,
  avatar        text,                          -- პატარა სურათი data:URL სახით (≤150KB)
  interests     text not null default '',
  failed_logins int  not null default 0,
  locked_until  timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists sessions (
  token       text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions(user_id);

create table if not exists groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  icon         text,                           -- ემოჯი ან data:URL სურათი
  budget       text not null default '',
  max_players  int  not null default 20 check (max_players between 3 and 200),
  roll_at      timestamptz,                    -- ავტომატური გათამაშების დრო
  rolled_at    timestamptz,                    -- როდის გათამაშდა
  invite_code  text not null unique,
  owner_id     uuid not null references users(id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index if not exists groups_due_idx on groups(roll_at) where rolled_at is null;

create table if not exists members (
  group_id   uuid not null references groups(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists members_user_idx on members(user_id);

create table if not exists assignments (
  group_id     uuid not null references groups(id) on delete cascade,
  giver_id     uuid not null references users(id) on delete cascade,
  receiver_id  uuid not null references users(id) on delete cascade,
  primary key (group_id, giver_id)
);

-- უსაფრთხოება: Supabase-ის საჯარო API-ს (anon key) არაფერზე აქვს წვდომა.
-- საიტი ბაზას მხოლოდ სერვერიდან (Netlify Functions) უკავშირდება.
alter table users       enable row level security;
alter table sessions    enable row level security;
alter table groups      enable row level security;
alter table members     enable row level security;
alter table assignments enable row level security;
