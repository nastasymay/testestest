FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node public ./public
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
EXPOSE 3000
CMD ["node", "server.mjs"]
