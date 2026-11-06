# Postgres 18 clients plus a pinned, proven S3 client for backups and restore drills.
FROM rclone/rclone:1.70.3 AS rclone
FROM postgres:18-alpine
RUN apk add --no-cache ca-certificates coreutils tzdata util-linux \
    && mkdir -p /opt/codechatter-backup /backups \
    && chown 70:70 /backups
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
COPY common.sh backup.sh restore.sh entrypoint.sh /opt/codechatter-backup/
RUN chmod 755 /opt/codechatter-backup/*.sh
USER 70:70
ENV BACKUP_DIR=/backups BACKUP_TZ=UTC
ENTRYPOINT ["/opt/codechatter-backup/entrypoint.sh"]
CMD ["schedule"]
