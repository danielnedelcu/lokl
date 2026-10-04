# public.provider_ratings

## Description

Each provider's published reviews across all their listings (including ones no longer live): count, star total and average. Kept by the reviews_recount trigger.

## Columns

| Name           | Type                     | Default | Nullable | Extra Definition                                                                                                                                                                | Children | Parents                                 | Comment                                                                                |
| -------------- | ------------------------ | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| provider_id    | uuid                     |         | false    |                                                                                                                                                                                 |          | [public.providers](public.providers.md) |                                                                                        |
| review_count   | integer                  | 0       | false    |                                                                                                                                                                                 |          |                                         |                                                                                        |
| rating_total   | integer                  | 0       | false    |                                                                                                                                                                                 |          |                                         |                                                                                        |
| rating_average | numeric(2,1)             |         | true     | GENERATED ALWAYS AS <br />CASE<br />    WHEN (review_count \> 0) THEN round(((rating_total)::numeric / (review_count)::numeric), 1)<br />    ELSE NULL::numeric<br />END STORED |          |                                         |                                                                                        |
| updated_at     | timestamp with time zone | now()   | false    |                                                                                                                                                                                 |          |                                         |                                                                                        |
| stars_1        | integer                  | 0       | false    |                                                                                                                                                                                 |          |                                         |                                                                                        |
| stars_2        | integer                  | 0       | false    |                                                                                                                                                                                 |          |                                         |                                                                                        |
| stars_3        | integer                  | 0       | false    |                                                                                                                                                                                 |          |                                         |                                                                                        |
| stars_4        | integer                  | 0       | false    |                                                                                                                                                                                 |          |                                         |                                                                                        |
| stars_5        | integer                  | 0       | false    |                                                                                                                                                                                 |          |                                         | Published reviews with 5 stars (stars_1 to stars_4 likewise). Kept by recount_ratings. |

## Constraints

| Name                                | Type        | Definition                                                                       |
| ----------------------------------- | ----------- | -------------------------------------------------------------------------------- |
| provider_ratings_rating_total_check | CHECK       | CHECK ((rating_total >= 0))                                                      |
| provider_ratings_review_count_check | CHECK       | CHECK ((review_count >= 0))                                                      |
| provider_ratings_stars_1_check      | CHECK       | CHECK ((stars_1 >= 0))                                                           |
| provider_ratings_stars_2_check      | CHECK       | CHECK ((stars_2 >= 0))                                                           |
| provider_ratings_stars_3_check      | CHECK       | CHECK ((stars_3 >= 0))                                                           |
| provider_ratings_stars_4_check      | CHECK       | CHECK ((stars_4 >= 0))                                                           |
| provider_ratings_stars_5_check      | CHECK       | CHECK ((stars_5 >= 0))                                                           |
| provider_ratings_stars_add_up       | CHECK       | CHECK ((((((stars_1 + stars_2) + stars_3) + stars_4) + stars_5) = review_count)) |
| provider_ratings_provider_id_fkey   | FOREIGN KEY | FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE             |
| provider_ratings_pkey               | PRIMARY KEY | PRIMARY KEY (provider_id)                                                        |

## Indexes

| Name                  | Definition                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| provider_ratings_pkey | CREATE UNIQUE INDEX provider_ratings_pkey ON public.provider_ratings USING btree (provider_id) |

## Relations

![er](public.provider_ratings.svg)

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
