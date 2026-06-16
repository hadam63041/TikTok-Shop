# Hermes Command — dashboard + agent in one container.
# The Node agent (HermesAgent/server.js) serves both the /api endpoints and the
# static dashboard (it loads ../HermesDashboard), so we keep that folder layout.
FROM node:22-alpine

# Install agent deps first (better layer caching).
WORKDIR /app/HermesAgent
COPY HermesAgent/package.json ./
RUN npm install --omit=dev

# App code: agent + the dashboard it serves.
COPY HermesAgent/ /app/HermesAgent/
COPY HermesDashboard/ /app/HermesDashboard/

# Runtime defaults — override OPENAI_API_KEY etc. at deploy time.
ENV PORT=8787 \
    AGENT_BACKEND=openai \
    OPENAI_MODEL=gpt-5 \
    STATE_FILE=/data/state.json

EXPOSE 8787
VOLUME ["/data"]

CMD ["node", "server.js"]
