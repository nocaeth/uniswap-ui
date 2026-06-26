# Gnosis analytics adapter — serves ExploreStats (ConnectRPC) + GraphQL on Envio.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
ENV PORT=8081
EXPOSE 8081
CMD ["node", "dist/server.js"]
