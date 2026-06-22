FROM node:20-alpine AS build
WORKDIR /app

COPY package.json ./

# Install runtime + build dependencies fresh from package.json.
# Do not use package-lock here because stale lock files caused Vite to be missing.
RUN npm install --include=dev --legacy-peer-deps

# Hard guarantee: Vite must exist before build starts.
RUN test -f node_modules/vite/bin/vite.js

COPY . .

# Call Vite directly so the build does not depend on shell PATH resolution.
RUN node node_modules/vite/bin/vite.js build

FROM nginx:1.27-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
