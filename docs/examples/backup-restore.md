# Docker volume backup and restore snippets

These examples back up the default `launcher-data` volume. Stop the app before restoring.

## Backup

```bash
docker run --rm \
  -v home-lab-launcher_launcher-data:/data:ro \
  -v "$PWD/backups:/backup" \
  busybox tar czf /backup/launcher-data-$(date +%Y%m%d-%H%M%S).tgz -C /data .
```

## Restore

```bash
docker compose down
docker run --rm \
  -v home-lab-launcher_launcher-data:/data \
  -v "$PWD/backups:/backup:ro" \
  busybox sh -c 'rm -rf /data/* && tar xzf /backup/launcher-data.tgz -C /data'
docker compose up -d
```

Adjust the volume name if your Compose project name is not `home-lab-launcher`.
