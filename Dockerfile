FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false

COPY . .
RUN yarn build

ENV NODE_ENV=production

EXPOSE 7272

CMD ["yarn", "start"]
