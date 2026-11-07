// Offer Desk schema. Inlined so it ships with the serverless bundle. Safe to run repeatedly.
export const SCHEMA = `
create table if not exists listings (
  listing_id      bigint primary key,
  mls_number      text not null,
  address         text not null,
  city            text,
  zip             text,
  lat             double precision,
  lon             double precision,
  list_price      integer,
  original_price  integer,
  beds            numeric,
  baths           numeric,
  sqft            integer,
  property_type   text,
  subtype         text,
  status          text,
  remarks         text,
  dom             integer,
  hoa_monthly     integer,
  taxes           integer,
  agent_name      text,
  agent_email     text,
  agent_phone     text,
  office_name     text,
  photo_urls      jsonb default '[]',
  event           text,
  keyword_hits    jsonb default '[]',
  signals         jsonb default '[]',
  score           integer default 0,
  arv             integer,
  arv_comps       jsonb default '[]',
  arv_warnings    jsonb default '[]',
  condition_tier  text,
  condition_notes text,
  has_interior    boolean,
  repairs_low     integer,
  repairs_high    integer,
  flood_zone      text,
  flood_sfha      boolean,
  action          text,
  offer_price     integer,
  offer_formula   text,
  offer_reasons   jsonb default '[]',
  first_seen      timestamptz default now(),
  last_changed    timestamptz default now(),
  analyzed_at     timestamptz,
  hidden          boolean default false
);
create index if not exists listings_score on listings (score desc);
create index if not exists listings_first_seen on listings (first_seen desc);

create table if not exists sold_comps (
  listing_id   bigint primary key,
  address      text,
  lat          double precision,
  lon          double precision,
  beds         numeric,
  sqft         integer,
  property_type text,
  sale_price   integer,
  close_date   date,
  remarks      text
);

create table if not exists offers (
  id           serial primary key,
  listing_id   bigint references listings(listing_id),
  kind         text not null,
  price        integer,
  to_email     text,
  subject      text,
  body         text,
  status       text not null default 'draft',
  created_at   timestamptz default now(),
  sent_at      timestamptz,
  reply_status text,
  pof_requested boolean default false,
  notes        text
);
create index if not exists offers_sent_at on offers (sent_at desc nulls last);

create table if not exists scan_runs (
  id          serial primary key,
  started_at  timestamptz default now(),
  finished_at timestamptz,
  matches     integer,
  new_count   integer,
  changed_count integer,
  analyzed    integer,
  error       text
);
`;
