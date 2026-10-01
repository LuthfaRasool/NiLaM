# NiLaM API and dashboard image.
#
# Multi-stage: install from the local cache, build the web app, then run. The
# offline installer works against the cacache volume mounted from the build host,
# which is the honest equivalent of `npm install` for an environment with no
# registry.

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
COPY tools/offline-install.mjs tools/
COPY tools/build-web.mjs tools/
COPY packages ./packages
COPY apps ./apps
COPY services ./services
COPY db ./db

# The offline installer reads the host's npm cache; in a networked build this can
# be replaced with `npm install`.
RUN node tools/offline-install.mjs install . && \
    node tools/build-web.mjs

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
COPY --from=build /app/services ./services
COPY --from=build /app/db ./db
COPY package.json ./

EXPOSE 4180
CMD ["node", "services/api/server.mjs"]
