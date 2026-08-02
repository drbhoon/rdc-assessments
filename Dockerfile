# ─── Build the React client ──────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
# devDependencies hold vite and the plugins, so a full install is required.
RUN npm install --no-audit --no-fund

COPY . .

# Both of these are baked into the bundle by Vite and cannot be supplied at
# runtime: BASE_PATH becomes the asset base, VITE_ADMIN_PASSWORD is read
# through import.meta.env in the admin page.
ARG BASE_PATH=""
ARG VITE_ADMIN_PASSWORD=""
ENV BASE_PATH=$BASE_PATH
ENV VITE_ADMIN_PASSWORD=$VITE_ADMIN_PASSWORD
RUN npm run build

# ─── Runtime: Express serves the API and the built client ────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Read by server/index.js to mount every route under the prefix.
ARG BASE_PATH=""
ENV BASE_PATH=$BASE_PATH

COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server ./server
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "server/index.js"]
