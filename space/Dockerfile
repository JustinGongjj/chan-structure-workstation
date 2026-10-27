FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8931 \
    HOST=0.0.0.0

WORKDIR /app
COPY . .

# Hugging Face Spaces 以 user 1000 运行
RUN mkdir -p /app/data && chown -R 1000:1000 /app
USER 1000
EXPOSE 8931
CMD ["node", "server/index.js"]
