# Deploy Hermes Command on your VPS (Codex brain)

Run the whole dashboard **on the VPS** with **OpenAI Codex as the brain**, then
open it from your Hermes agent. Everything below uses Docker via the Hostinger
panel — no Mac needed once it's up.

What you'll end up with:
- Hermes Command running at `http://<your-vps-ip>:8788` (optionally a subdomain).
- Its agent roster (Hermes, Research, Operations, …) thinking with **Codex**
  (`AGENT_BACKEND=openai`), using the same OpenAI key your Hermes platform uses.
- A link from your Hermes UI that opens it.

---

## Step 1 — Get this project onto the VPS

Pick whichever is easier in your Hostinger setup:

**A. Git (recommended).** Push this folder to a GitHub repo, then on the VPS
(hPanel → your VPS → **Browser terminal**):
```sh
git clone https://github.com/<you>/<repo>.git hermes-command
cd hermes-command
```

**B. Upload.** hPanel → **File Manager** → upload the project folder, then open
the Browser terminal and `cd` into it.

> The folder must contain `Dockerfile`, `docker-compose.yml`, `HermesAgent/`,
> and `HermesDashboard/`.

## Step 2 — Add your keys

In the project folder, create `deploy.env` from the template and fill it in:
```sh
cp deploy.env.example deploy.env
nano deploy.env        # paste OPENAI_API_KEY (and SerpApi/Printify/Zendrop if you want)
```
`OPENAI_API_KEY` is the only required one — it's your OpenAI/Codex key (the same
one your Hermes platform uses). `OPENAI_MODEL` defaults to `gpt-5`; set it to a
Codex model if your account uses one.

## Step 3 — Build & start it

In the Browser terminal, from the project folder:
```sh
docker compose --env-file deploy.env up -d --build
```
Check it's healthy:
```sh
docker compose logs --tail 30
# look for: ⚡ Hermes agent on http://localhost:8787  +  "key loaded — agent ONLINE"
```

> Using Hostinger's Docker GUI instead of the terminal? Point it at this
> `docker-compose.yml`, add the env vars from `deploy.env` in its environment
> fields, and deploy.

## Step 4 — Open the port

The container exposes host port **8788**. Open it on the VPS firewall (hPanel →
**Firewall**, allow TCP 8788), then visit:
```
http://<your-vps-ip>:8788
```
You should see the dashboard, with the header banner green (**agent online**) and
the agents in the left menu running on Codex.

## Step 5 — Link it from your Hermes agent

In your Hermes platform's UI, add a link/tile to `http://<your-vps-ip>:8788`
(Hermes supports custom dashboard links/plugins). Now you can open Hermes Command
straight from the Hermes agent.

---

## Optional — a real subdomain with HTTPS

If you have a domain pointed at the VPS, add a reverse-proxy vhost (Caddy/nginx/
Traefik) for e.g. `command.yourdomain.com → 127.0.0.1:8788`, so you get
`https://command.yourdomain.com` instead of an IP:port. (Ask me and I'll generate
the exact vhost for your proxy.)

## Updating later
```sh
git pull          # or re-upload
docker compose --env-file deploy.env up -d --build
```
State (designs, pricing, etc.) persists in the `hermes_data` Docker volume.

## Notes
- Secrets live only in `deploy.env` / the container environment on the VPS —
  never in the dashboard files the browser downloads.
- No `ANTHROPIC_API_KEY` is needed when `AGENT_BACKEND=openai`.
