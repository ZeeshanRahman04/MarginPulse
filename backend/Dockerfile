FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json ./
RUN npm install --omit=dev && apk del python3 make g++
COPY . .
ENV NODE_ENV=production
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:4000/health || exit 1
CMD ["node", "src/index.js"]
