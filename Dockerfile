FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/moment.db
COPY --from=build /app ./
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
