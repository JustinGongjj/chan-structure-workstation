# Deploy

The app is a single Node process (zero runtime dependencies) + static files.

## 1. Local / VPS

```bash
npm start                       # http://localhost:8931
PORT=8080 HOST=127.0.0.1 npm start
```

Put it behind Nginx/Caddy for HTTPS (required for PWA install and service worker):

```nginx
location / {
  proxy_pass http://127.0.0.1:8931;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

## 2. Docker

```bash
docker build -t chan-station .
docker run -d --name chan-station -p 8931:8931 -v "$PWD/data:/app/data" chan-station
# or
docker compose up -d
```

`data/watchlist.json` is the only mutable state — mount it.

## 3. Hugging Face Spaces (recommended for the demo)

The `space/` directory is a ready-to-duplicate Space (Docker SDK):

1. Create a new Space → SDK: **Docker** → blank.
2. Upload the contents of `space/` **plus** `server/`, `web/`, `data/`, `package.json`.
   (Or point a Space at this repo and set the Dockerfile path.)
3. `app_port` in the Space README is `8931`; the container listens on `0.0.0.0:8931`.
4. First build takes ~1–2 min (no npm install).

Notes:

- Free Spaces sleep after inactivity; the first request after sleep takes a few seconds.
- The public endpoint must be reachable from the internet for data adapters to work —
  if the Space's egress is restricted, crypto/US adapters still work but A-share ones may not.
- Set `PORT=8931` explicitly if you customize the Dockerfile.

## 4. Fly.io / Railway / Render

Any "deploy a Dockerfile" target works:

- port: `8931`
- health check: `GET /api/health`
- volume: mount at `/app/data` to persist the watchlist
- no environment variables are required

## 5. Static hosting caveat

The frontend is static, but the API is not — you cannot drop `web/` on GitHub Pages
and expect data. Either run the Node server or split: host the UI on Pages and point
`API_BASE` at your server (requires a small change in `web/js/api.js`).

## Reverse proxy & security

- Do not expose the server without HTTPS if you install the PWA.
- There is no authentication. If you run it publicly, consider adding IP allow-listing
  at the proxy, or a simple token check in `server/index.js`.
- Free data providers may rate-limit by IP — one instance per IP is the intended usage.
