FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Fail with a clear message if the wrong directory/ZIP was pushed to Dokploy.
RUN if [ ! -f src/main.tsx ] || [ ! -f src/App.tsx ]; then echo 'ERROR: Easy Gram source files are missing. Set the Docker build context to the project root containing src/main.tsx and src/App.tsx.' >&2; exit 1; fi
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
