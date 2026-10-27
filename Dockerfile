FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3080 \
    DATA_DIR=/app/data \
    TZ=Europe/Stockholm
WORKDIR /app
RUN mkdir -p /app/data && chown node:node /app/data
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node server.mjs csv-import.mjs activity.mjs reminders.mjs email-settings.mjs schedule-upgrade.mjs roles.mjs schedule.mjs notifications.mjs password-reset.mjs calendar.mjs news.mjs recurring.mjs checklist.mjs members.mjs ./
COPY --chown=node:node public ./public
USER node
EXPOSE 3080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
