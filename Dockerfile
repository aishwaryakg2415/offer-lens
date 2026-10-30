FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/data/offer-lens.db
EXPOSE 3000
VOLUME ["/app/data"]
RUN mkdir -p /app/data && chown node /app/data
USER node
CMD ["npm", "start"]
