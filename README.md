# bible-api

Express API over a Redis Stack database of the Bible texts. Settings come from
the environment or a `.env` file in the working directory; see `.env.example`.

```sh
docker compose -f docker/docker-compose.yml up -d   # Redis Stack on 127.0.0.1:6379
npm start
npm test
```

## +365 reminders

The app can subscribe to a daily Web Push reminder for the +365 plan
(`GET /v1/mais365/reminders/key`, `PUT` and `DELETE /v1/mais365/reminders`).
Every minute the API sends each subscription its reminder once its local time
has passed, unless that day was already read or reminded; one enabled after
that day's time first hears from it the next day. Only endpoints on the
browsers' push services (FCM, Apple, Mozilla, WNS) are accepted, and a
subscription whose sends fail seven days running is dropped.

It needs a VAPID key pair, generated once and kept:

```sh
npx web-push generate-vapid-keys
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` or
`https:` contact) and restart. Without them the routes answer 503 and nothing is
sent. Subscriptions are stored in the Redis database after `DB_URL`'s (`/1` for
the default `/0`), so a reimport does not erase them, but they cannot be
rebuilt either: keep Redis persistence on.
