#!/bin/bash
BACKUP_DIR="/data/backup"
DB_CONTAINER="workday_db"
DB_NAME="workday"
DB_USER="postgres"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/workday_$TIMESTAMP.sql.gz"
RETENTION_DAYS=7

mkdir -p $BACKUP_DIR

echo "[$TIMESTAMP] Starting backup..."

docker exec $DB_CONTAINER pg_dump -U $DB_USER $DB_NAME | gzip > $BACKUP_FILE

if [ $? -eq 0 ]; then
    SIZE=$(du -sh $BACKUP_FILE | cut -f1)
    echo "[$TIMESTAMP] ✅ Backup successful: $BACKUP_FILE ($SIZE)"
else
    echo "[$TIMESTAMP] ❌ Backup FAILED!"
    exit 1
fi

find $BACKUP_DIR -name "workday_*.sql.gz" -mtime +$RETENTION_DAYS -delete
echo "[$TIMESTAMP] 🧹 Old backups cleaned up"
echo "[$TIMESTAMP] 📦 Current backups:"
ls -lh $BACKUP_DIR
