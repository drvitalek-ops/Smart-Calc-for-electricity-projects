FROM postgres:17-alpine

COPY backup.sh /usr/local/bin/smart-calc-backup
RUN chmod 0755 /usr/local/bin/smart-calc-backup

ENTRYPOINT ["/usr/local/bin/smart-calc-backup"]
