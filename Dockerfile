# Chan Structure Workstation — zero-dependency Node.js image
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8931 \
    HOST=0.0.0.0

WORKDIR /app

# 运行期零依赖：只拷贝源码
COPY server ./server
COPY web ./web
COPY package.json ./
COPY data ./data

# 非 root 运行（兼容 Hugging Face Spaces 的 user 1000）
RUN addgroup -g 1000 app 2>/dev/null || true \
 && adduser -D -u 1000 -G app app 2>/dev/null || true \
 && mkdir -p /app/data && chown -R 1000:1000 /app

USER 1000
EXPOSE 8931

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8931)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
